const crypto = require('node:crypto');
const { db } = require('../firebaseAdmin');
const { enviarWhatsappTextMeBot } = require('../lib/textmebot');

const segredo = () => process.env.CENTRAL_INTEGRATION_SECRET || '';
const digitos = (v) => String(v || '').replace(/\D/g, '');
const telefone = (v) => { const n = digitos(v); return n.startsWith('55') && n.length > 11 ? n.slice(2) : n; };
const assinar = (texto) => crypto.createHmac('sha256', segredo()).update(texto).digest('hex');
function autorizado(req) {
  const recebido = String(req.headers['x-central-secret'] || ''); const esperado = segredo();
  return esperado && recebido.length === esperado.length && crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado));
}
async function localizar(numero) {
  const alvo = telefone(numero); const dados = (await db.ref('clientes').once('value')).val() || {};
  const achado = Object.entries(dados).find(([, c]) => telefone(c?.whatsapp) === alvo);
  return achado ? { id: achado[0], ...achado[1] } : null;
}
function resumo(c, apps) {
  return { nome: c.nome || 'Cliente', status: c.status || 'desconhecido', servidor: c.servidor || '', vencimento: c.vencimento || null,
    aplicativos: (c.aplicativosIds || []).map((id) => apps[id]?.nome).filter(Boolean), temDadosAcesso: !!(c.usuario || c.senha || c.m3uLink) };
}
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });
  if (!autorizado(req)) return res.status(401).json({ erro: 'Não autorizado.' });
  const { acao, whatsapp, codigo, prova } = req.body || {}; const numero = telefone(whatsapp);
  if (!/^\d{10,11}$/.test(numero)) return res.status(400).json({ erro: 'WhatsApp inválido.' });
  const cliente = await localizar(numero); if (!cliente) return res.status(404).json({ encontrado: false });
  const apps = (await db.ref('aplicativos').once('value')).val() || {};
  if (acao === 'perfil') return res.status(200).json({ encontrado: true, perfil: resumo(cliente, apps) });
  const chave = crypto.createHash('sha256').update(numero).digest('hex');
  if (acao === 'enviar_codigo') {
    const valor = String(crypto.randomInt(100000, 1000000)); const expiraEm = Date.now() + 10 * 60 * 1000;
    await db.ref('centralVerificacoes/' + chave).set({ hash: assinar(numero + ':' + valor + ':' + expiraEm), expiraEm, tentativas: 0 });
    const envio = await enviarWhatsappTextMeBot('55' + numero, 'MultiFlix: seu código de confirmação é ' + valor + '. Ele expira em 10 minutos. Não compartilhe este código.');
    if (!envio.enviado) return res.status(503).json({ erro: 'Não foi possível enviar o código agora.' });
    return res.status(200).json({ enviado: true });
  }
  if (acao === 'confirmar_codigo') {
    const ref = db.ref('centralVerificacoes/' + chave); const registro = (await ref.once('value')).val();
    if (!registro || registro.expiraEm < Date.now() || !/^\d{6}$/.test(String(codigo || '')) || registro.hash !== assinar(numero + ':' + codigo + ':' + registro.expiraEm)) return res.status(401).json({ erro: 'Código inválido ou expirado.' });
    await ref.remove(); const expiraEm = Date.now() + 10 * 60 * 1000;
    return res.status(200).json({ prova: expiraEm + '.' + assinar(numero + ':' + expiraEm) });
  }
  if (acao === 'dados') {
    const [expiraEm, assinatura] = String(prova || '').split('.');
    if (!/^\d+$/.test(expiraEm || '') || Number(expiraEm) < Date.now() || assinatura !== assinar(numero + ':' + expiraEm)) return res.status(401).json({ erro: 'Confirmação necessária.' });
    return res.status(200).json({ dados: { usuario: cliente.usuario || '', senha: cliente.senha || '', m3uLink: cliente.m3uLink || '', servidor: cliente.servidor || '' } });
  }
  return res.status(400).json({ erro: 'Ação inválida.' });
};
