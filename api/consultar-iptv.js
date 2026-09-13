const { consultarContaXtream, consultarContaMusica } = require('../lib/xtream');
const crypto = require('node:crypto');
const { enviarWhatsappTextMeBot } = require('../lib/textmebot');
const num = v => String(v || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
const sec = () => process.env.CENTRAL_INTEGRATION_SECRET || '';
const sig = s => crypto.createHmac('sha256', sec()).update(s).digest('hex');
async function central(req, res) {
  const { db } = require('../lib/firebaseAdmin');
  const recebido=String(req.headers['x-central-secret']||''), esperado=sec(); if(!esperado||recebido.length!==esperado.length||!crypto.timingSafeEqual(Buffer.from(recebido),Buffer.from(esperado))) return res.status(401).json({erro:'Não autorizado.'});
  const telefone=num(req.body.whatsapp), clientes=(await db.ref('clientes').once('value')).val()||{}, achado=Object.entries(clientes).find(([,c])=>num(c?.whatsapp)===telefone); if(!achado)return res.status(404).json({encontrado:false}); const [,c]=achado, acao=req.body.acao;
  if(acao==='central_perfil'){const apps=(await db.ref('aplicativos').once('value')).val()||{};return res.json({encontrado:true,perfil:{nome:c.nome||'Cliente',status:c.status||'',servidor:c.servidor||'',vencimento:c.vencimento||null,aplicativos:(c.aplicativosIds||[]).map(x=>apps[x]?.nome).filter(Boolean),temDadosAcesso:!!(c.usuario||c.senha||c.m3uLink)}})}
  const chave=crypto.createHash('sha256').update(telefone).digest('hex'),ref=db.ref('centralVerificacoes/'+chave);
  if(acao==='central_enviar_codigo'){const codigo=String(crypto.randomInt(100000,1000000)),expiraEm=Date.now()+600000;await ref.set({hash:sig(telefone+':'+codigo+':'+expiraEm),expiraEm});const envio=await enviarWhatsappTextMeBot('55'+telefone,'MultiFlix: seu código de confirmação é '+codigo+'. Ele expira em 10 minutos. Não compartilhe este código.');return envio.enviado?res.json({enviado:true}):res.status(503).json({erro:'Não foi possível enviar o código.'})}
  if(acao==='central_confirmar_codigo'){const r=(await ref.once('value')).val(),codigo=String(req.body.codigo||'');if(!r||r.expiraEm<Date.now()||!/^\d{6}$/.test(codigo)||r.hash!==sig(telefone+':'+codigo+':'+r.expiraEm))return res.status(401).json({erro:'Código inválido ou expirado.'});await ref.remove();const expiraEm=Date.now()+600000;return res.json({prova:expiraEm+'.'+sig(telefone+':'+expiraEm)})}
  if(acao==='central_dados'){const[exp,assinatura]=String(req.body.prova||'').split('.');if(!/^\d+$/.test(exp||'')||Number(exp)<Date.now()||assinatura!==sig(telefone+':'+exp))return res.status(401).json({erro:'Confirmação necessária.'});return res.json({dados:{usuario:c.usuario||'',senha:c.senha||'',m3uLink:c.m3uLink||'',servidor:c.servidor||''}})}
  return res.status(400).json({erro:'Ação inválida.'});
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ erro: `Método ${req.method} não permitido` });
  }

  try {
    if (String(req.body?.acao || '').startsWith('central_')) {
      try { return await central(req, res); }
      catch (erro) { console.error('Central:', erro); return res.status(500).json({ erro: 'Falha na integração da Central.', detalhe: String(erro.message || erro).slice(0, 180) }); }
    }
    const { link, tipoConsulta, usuario, senha, apiBase } = req.body || {};

    let resultado;
    if (tipoConsulta === 'musica') {
      resultado = await consultarContaMusica(usuario, senha, apiBase);
    } else {
      if (!link) {
        return res.status(400).json({ erro: 'link é obrigatório' });
      }
      resultado = await consultarContaXtream(link);
    }

    if (resultado.erro) {
      return res.status(422).json(resultado);
    }

    return res.status(200).json(resultado);
  } catch (err) {
    console.error('Erro em /api/consultar-iptv:', err);
    return res.status(500).json({ erro: 'Erro interno ao consultar o painel' });
  }
};
