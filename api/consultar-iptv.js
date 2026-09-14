const { consultarContaXtream, consultarContaMusica } = require('../lib/xtream');
const crypto = require('node:crypto');
const { Resend } = require('resend');
const { enviarWhatsappTextMeBot } = require('../lib/textmebot');
const { consultarRenovacaoMultiflix } = require('../lib/multiflix-renovacao');
const { criarCobrancaCheckout } = require('../lib/mercadopago');
const resend = new Resend(process.env.RESEND_API_KEY);
const num = v => String(v || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
const sec = () => process.env.CENTRAL_INTEGRATION_SECRET || '';
const sig = s => crypto.createHmac('sha256', sec()).update(s).digest('hex');
const emailValido = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(v || '').trim());
const appsDoCliente = (cliente, apps, incluirCodigo = false) => (cliente.aplicativosIds || [])
  .map((id) => apps[id])
  .filter(Boolean)
  .map((app) => incluirCodigo ? { nome: String(app.nome || ''), codigo: String(app.codigo || '') } : { nome: String(app.nome || '') })
  .filter((app) => app.nome);
const clienteMultiflix = cliente => /multiflix/i.test(String(cliente?.servidor || '')) || /x\.fenixsocial\.site/i.test(String(cliente?.m3uLink || ''));

async function central(req, res) {
  const { db } = require('../lib/firebaseAdmin');
  const recebido=String(req.headers['x-central-secret']||''), esperado=sec(); if(!esperado||recebido.length!==esperado.length||!crypto.timingSafeEqual(Buffer.from(recebido),Buffer.from(esperado))) return res.status(401).json({erro:'Não autorizado.'});
  const telefone=num(req.body.whatsapp), clientes=(await db.ref('clientes').once('value')).val()||{}, achado=Object.entries(clientes).find(([,c])=>num(c?.whatsapp)===telefone), acao=req.body.acao;
  if(acao==='central_registrar_atendimento'){
    const tipo=String(req.body.tipo||'duvida').slice(0,40),detalhe=String(req.body.detalhe||'').slice(0,180);
    const cliente=achado?.[1]||{};
    await db.ref('centralAtendimentos').push({clienteId:achado?.[0]||'',nome:String(cliente.nome||'Novo atendimento').slice(0,100),whatsapp:telefone,tipo,detalhe,criadoEm:Date.now()});
    return res.json({registrado:true});
  }
  if(!achado)return res.status(404).json({encontrado:false}); const [,c]=achado;
  const apps=(await db.ref('aplicativos').once('value')).val()||{};
  if(acao==='central_perfil') return res.json({encontrado:true,perfil:{nome:c.nome||'Cliente',status:c.status||'',servidor:c.servidor||'',vencimento:c.vencimento||null,aplicativos:appsDoCliente(c,apps).map((app)=>app.nome),temDadosAcesso:!!(c.usuario||c.senha||c.m3uLink),temEmailCadastrado:!!emailValido(c.email),emailVerificado:!!(c.email&&c.emailVerificadoEm)}});
  if(acao==='central_consultar_renovacao'){
    if(!clienteMultiflix(c)) return res.json({automatico:false,mensagem:'💬 Vamos ajudar com sua renovação\n\nNo momento, as renovações deste serviço são realizadas diretamente pelo nosso atendimento no WhatsApp.\n\nAssim conseguimos conferir as opções disponíveis para a sua conta e orientar você da melhor forma. 😊'});
    if(!c.usuario) return res.status(409).json({erro:'Não localizei o usuário MultiFlix desta conta para consultar a renovação.'});
    const consulta=await consultarRenovacaoMultiflix(c.usuario);
    if(!consulta?.encontrado||!consulta.plano) return res.status(409).json({erro:'Não consegui localizar o plano MultiFlix desta conta agora. Fale com nosso suporte pelo WhatsApp.'});
    const ofertaId=crypto.randomBytes(20).toString('hex'),expiraEm=Date.now()+15*60*1000;
    await db.ref('centralRenovacoes/'+ofertaId).set({clienteId:achado[0],telefone,usuario:c.usuario,plano:consulta.plano,expiraEm,criadoEm:Date.now()});
    return res.json({automatico:true,oferta:{token:ofertaId,plano:consulta.plano}});
  }
  if(acao==='central_gerar_cobranca_renovacao'){
    const ofertaId=String(req.body.oferta||''),ofertaRef=db.ref('centralRenovacoes/'+ofertaId),oferta=(await ofertaRef.once('value')).val();
    if(!/^[a-f0-9]{40}$/.test(ofertaId)||!oferta||oferta.clienteId!==achado[0]||oferta.expiraEm<Date.now()) return res.status(401).json({erro:'Essa oferta expirou. Solicite a renovação novamente para consultar o plano atualizado.'});
    if(oferta.cobranca?.linkPagamento) return res.json({cobranca:oferta.cobranca,reutilizada:true});
    const renovacaoId=crypto.randomBytes(20).toString('hex'),referencia='renovacao:'+renovacaoId;
    const cobranca=await criarCobrancaCheckout({referencia,email:c.email,nome:c.nome,valor:oferta.plano.valor,descricao:'Renovação MultiFlix — '+oferta.plano.nome});
    const registro={clienteId:achado[0],telefone,usuario:oferta.usuario,plano:oferta.plano,valor:oferta.plano.valor,status:'aguardando_pagamento',criadoEm:Date.now(),preferenceId:cobranca.preferenceId,linkPagamento:cobranca.linkPagamento};
    await db.ref().update({['renovacoes/'+renovacaoId]:registro,['centralRenovacoes/'+ofertaId+'/cobranca']:{...cobranca,renovacaoId}});
    return res.json({cobranca:{...cobranca,renovacaoId}});
  }
  const chave=crypto.createHash('sha256').update(telefone).digest('hex'),ref=db.ref('centralVerificacoes/'+chave);
  if(acao==='central_enviar_codigo_email'){
    const emailInformado=String(req.body.email||'').trim().toLowerCase(),emailCadastrado=String(c.email||'').trim().toLowerCase();
    if(!emailValido(emailInformado)) return res.status(400).json({erro:'Informe um e-mail válido para continuar.'});
    if(emailValido(emailCadastrado)&&emailInformado!==emailCadastrado) return res.status(403).json({erro:'O e-mail informado não corresponde ao cadastro. Para alterar seu e-mail, fale com nosso atendimento pelo WhatsApp.'});
    const email=emailValido(emailCadastrado)?emailCadastrado:emailInformado;
    if(!process.env.RESEND_API_KEY||!process.env.RESEND_FROM) return res.status(503).json({erro:'O envio por e-mail está em configuração. Tente novamente mais tarde.'});
    const codigo=String(crypto.randomInt(100000,1000000)),expiraEm=Date.now()+600000;
    try {
      const envio=await resend.emails.send({from:process.env.RESEND_FROM,to:email,subject:'Código de confirmação — MultiFlix',text:'Olá, '+(c.nome||'cliente')+'!\n\nSeu código de confirmação da Central MultiFlix é: '+codigo+'\n\nEle expira em 10 minutos. Não compartilhe este código.'});
      if(envio?.error) { console.error('[Central e-mail] envio não confirmado:', envio.error.message||'erro do provedor'); return res.status(503).json({erro:'Não consegui enviar o e-mail agora. Confira o endereço e tente novamente.'}); }
    } catch(erro) { console.error('[Central e-mail] falha no envio:', erro?.message||erro); return res.status(503).json({erro:'Não consegui enviar o e-mail agora. Tente novamente mais tarde.'}); }
    await ref.set({hash:sig(telefone+':'+codigo+':'+expiraEm+':'+email),email,expiraEm});
    return res.json({enviado:true});
  }
  if(acao==='central_confirmar_codigo_email'){
    const r=(await ref.once('value')).val(),codigo=String(req.body.codigo||'');
    if(!r||r.expiraEm<Date.now()||!emailValido(r.email)||!/^\d{6}$/.test(codigo)||r.hash!==sig(telefone+':'+codigo+':'+r.expiraEm+':'+r.email)) return res.status(401).json({erro:'Código inválido ou expirado.'});
    await db.ref('clientes/'+achado[0]).update({email:r.email,emailVerificadoEm:Date.now()});
    await ref.remove(); const expiraEm=Date.now()+600000;
    return res.json({prova:expiraEm+'.'+sig(telefone+':'+expiraEm)});
  }
  if(acao==='central_salvar_push'){
    const token=String(req.body.token||'');
    if(token.length<80||token.length>4096) return res.status(400).json({erro:'Não consegui registrar as notificações neste navegador.'});
    await db.ref('clientes/'+achado[0]).update({fcmToken:token,notificacaoAtiva:true});
    return res.json({salvo:true});
  }
  if(acao==='central_enviar_codigo'){
    const codigo=String(crypto.randomInt(100000,1000000)),expiraEm=Date.now()+600000;
    const envio=await enviarWhatsappTextMeBot('55'+telefone,'MultiFlix: seu código de confirmação é '+codigo+'. Ele expira em 10 minutos. Não compartilhe este código.');
    if(!envio.enviado) return res.status(503).json({erro:'Não foi possível enviar o código agora. Tente novamente em alguns minutos.'});
    await ref.set({hash:sig(telefone+':'+codigo+':'+expiraEm),expiraEm});
    return res.json({enviado:true});
  }
  if(acao==='central_confirmar_codigo'){const r=(await ref.once('value')).val(),codigo=String(req.body.codigo||'');if(!r||r.expiraEm<Date.now()||!/^\d{6}$/.test(codigo)||r.hash!==sig(telefone+':'+codigo+':'+r.expiraEm))return res.status(401).json({erro:'Código inválido ou expirado.'});await ref.remove();const expiraEm=Date.now()+600000;return res.json({prova:expiraEm+'.'+sig(telefone+':'+expiraEm)})}
  if(acao==='central_dados'){const[exp,assinatura]=String(req.body.prova||'').split('.');if(!/^\d+$/.test(exp||'')||Number(exp)<Date.now()||assinatura!==sig(telefone+':'+exp))return res.status(401).json({erro:'Confirmação necessária.'});return res.json({dados:{usuario:c.usuario||'',senha:c.senha||'',m3uLink:c.m3uLink||'',servidor:c.servidor||'',aplicativos:appsDoCliente(c,apps,true)}})}
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
