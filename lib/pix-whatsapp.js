// Avisos pós-renovação. Nunca cria cobranças nem modifica o vencimento.
const crypto = require('node:crypto');
const INICIO = Date.parse('2026-10-15T20:57:00.000Z');
const RAIZ = 'pixWhatsappPendentes';
const INTERVALO = 6000;

function telefone(valor) {
  let n = String(valor || '').replace(/\D/g, '');
  if (n.length === 10 || n.length === 11) n = '55' + n;
  return /^55[1-9]\d{9,10}$/.test(n) ? n : '';
}
function mensagens(cliente, recibo) {
  const data = new Date(Number(recibo.vencimento)).toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'});
  const valor = Number(recibo.plano?.valor || 0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
  return {
    cliente: `✅ MultiFlix: pagamento confirmado e acesso renovado!\nNovo vencimento: ${data}.\nObrigado pela preferência!`,
    admin: `✅ Renovação automática MultiFlix\nCliente: ${String(cliente.nome || 'Não informado').slice(0,100)}\nUsuário: ${String(cliente.usuario || '').slice(0,100)}\nPlano: ${String(recibo.plano?.nome || 'Renovação').slice(0,100)}\nValor: ${valor}\nNovo vencimento: ${data}.`
  };
}

async function enviar({numero, texto, chave, fetchImpl = fetch}) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 10000);
  try {
    // POST: nem a chave nem a mensagem aparecem na URL ou nos logs.
    const r = await fetchImpl('https://api.textmebot.com/send.php?json=yes', {
      method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({recipient:numero, apikey:chave, text:texto, json:'yes'}).toString(), signal:ctl.signal
    });
    const textoResposta = await r.text();
    let dados; try { dados = JSON.parse(textoResposta); } catch (_) {}
    if (r.ok && dados?.status === 'success') return 'enviado';
    // Resposta desconhecida/timeout pode significar envio: não repetir às cegas.
    if (dados?.status === 'error') return 'recusado';
    return 'inconclusivo';
  } catch (_) { return 'inconclusivo'; }
  finally { clearTimeout(timer); }
}

function criarAvisos({db, env = process.env, agora = Date.now, pausa = ms => new Promise(r => setTimeout(r,ms)), enviarImpl = enviar}) {
  async function enfileirar(clienteId, pedidoId, origem) {
    if (!origem.confirmado || !origem.pagamentoId || !(Number(origem.concluidoEm) >= INICIO)
      || !(Number(origem.novoVencimento) > 0) || !/^[a-f0-9-]{36}$/.test(pedidoId)) return false;
    const ref = db.ref(`clientes/${clienteId}/pixAreaConfirmacoes/${pedidoId}`);
    const tx = await ref.transaction(c => {
      if (!c || String(c.pagamentoId) !== String(origem.pagamentoId) || c.whatsapp) return;
      return {...c, plano:origem.plano || {}, whatsapp:{cliente:'pendente',admin:'pendente',criadoEm:agora()}};
    });
    // Repara fila se a função foi interrompida entre a transação e o enqueue.
    const c = tx.snapshot.val();
    if (!c?.whatsapp || !['cliente','admin'].some(k => c.whatsapp[k] === 'pendente')) return false;
    await db.ref(`${RAIZ}/${pedidoId}`).transaction(v => v || {clienteId, criadoEm:agora()});
    return true;
  }

  async function processar() {
    if (!String(env.TEXTMEBOT_APIKEY || '').trim()) return;
    const token = crypto.randomUUID(), lock = db.ref('pixWhatsappControle');
    const tx = await lock.transaction(v => {
      if (Number(v?.ate) > agora()) return;
      return {token, ate:agora()+50000, ultimoFim:Number(v?.ultimoFim)||0};
    });
    if (!tx.committed) return;
    let ultimoFim = Number(tx.snapshot.val().ultimoFim)||0;
    const inicio = agora();
    try {
      // Lê no máximo quatro eventos. Não percorre todos os clientes.
      const fila = (await db.ref(RAIZ).orderByKey().limitToFirst(4).once('value')).val() || {};
      const config = (await db.ref('config/whatsappAdmin').once('value')).val();
      let quantidade = 0;
      for (const [pedidoId,item] of Object.entries(fila)) {
        if (agora()-inicio > 25000 || quantidade >= 2) break;
        const base = `clientes/${item.clienteId}`;
        const cliente = (await db.ref(base).once('value')).val();
        const recibo = cliente?.pixAreaConfirmacoes?.[pedidoId];
        if (!recibo?.whatsapp) { await db.ref(`${RAIZ}/${pedidoId}`).remove(); continue; }
        for (const tipo of ['cliente','admin']) {
          if (agora()-inicio > 25000 || quantidade >= 2) break;
          const ref = db.ref(`${base}/pixAreaConfirmacoes/${pedidoId}/whatsapp/${tipo}`);
          const estado = (await ref.once('value')).val();
          // Uma execução interrompida após começar um envio não é repetida.
          if (estado === 'enviando') { await ref.set('inconclusivo'); continue; }
          if (estado !== 'pendente') continue;
          const numero = telefone(tipo === 'cliente' ? cliente.whatsapp : config);
          if (!numero) { await ref.set('sem_numero'); continue; }
          const tomado = await ref.transaction(s => s === 'pendente' ? 'enviando' : undefined);
          if (!tomado.committed) continue;
          const espera = Math.max(0, ultimoFim+INTERVALO-agora());
          if (espera) await pausa(espera);
          let resultado;
          try { resultado = await enviarImpl({numero, texto:mensagens(cliente,recibo)[tipo], chave:env.TEXTMEBOT_APIKEY}); }
          catch (_) { resultado = 'inconclusivo'; }
          if (!['enviado','recusado','inconclusivo'].includes(resultado)) resultado = 'inconclusivo';
          await ref.set(resultado);
          ultimoFim = agora(); quantidade++;
          await lock.update({ultimoFim});
        }
        const estados = (await db.ref(`${base}/pixAreaConfirmacoes/${pedidoId}/whatsapp`).once('value')).val();
        if (!['cliente','admin'].some(k => estados?.[k] === 'pendente')) await db.ref(`${RAIZ}/${pedidoId}`).remove();
      }
    } finally {
      await lock.transaction(v => v?.token === token ? {ate:0,ultimoFim} : undefined);
    }
  }
  return {enfileirar, processar};
}

function agendar(db) {
  const {waitUntil} = require('@vercel/functions');
  waitUntil(criarAvisos({db}).processar().catch(() => {
    console.error('pix_whatsapp: processamento pendente; consulte os estados de envio.');
  }));
}
module.exports = {criarAvisos, agendar, telefone, mensagens, enviar, INICIO};
