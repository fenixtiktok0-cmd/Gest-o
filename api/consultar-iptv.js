const { consultarContaXtream, consultarContaMusica } = require('../lib/xtream');
const crypto = require('node:crypto');
const { Resend } = require('resend');
const { enviarWhatsappTextMeBot } = require('../lib/textmebot');
const { consultarRenovacaoMultiflix, renovarNoMultiflix } = require('../lib/multiflix-renovacao');
const { criarCobrancaPixCentral } = require('../lib/mercadopago');
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
const clienteMultiflix = cliente => /(?:multiflix|uni7)/i.test(String(cliente?.servidor || '')) || /x\.fenixsocial\.site/i.test(String(cliente?.m3uLink || ''));
const clienteAtivo = cliente => {
  if (!cliente || cliente.excluido === true || cliente.ativo === false) return false;
  return !/(?:exclu[ií]do|removido|cancelado|inativo)/i.test(String(cliente.status || ''));
};
const dataDoCadastro = cliente => Number(cliente?.atualizadoEm || cliente?.criadoEm || cliente?.cadastradoEm || cliente?.dataCadastro || 0) || 0;
const normalizar = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const destinatarioAceito = (nome, banco) => {
  const n=normalizar(nome), b=normalizar(banco);
  return (n==='MATHEUS GABRIEL DA SILVA FOGACA' && b==='C6') ||
    (n==='MARCOS PAULO SILVA FOGACA' && ['INTER','MERCADO PAGO','NUBANK'].includes(b));
};
const localizarClienteAtual = (clientes, telefone) => Object.entries(clientes || {})
  .filter(([, cliente]) => num(cliente?.whatsapp) === telefone && clienteAtivo(cliente))
  .sort(([, a], [, b]) => dataDoCadastro(b) - dataDoCadastro(a))[0];

async function central(req, res) {
  const { db } = require('../lib/firebaseAdmin');
  const recebido=String(req.headers['x-central-secret']||''), esperado=sec(); if(!esperado||recebido.length!==esperado.length||!crypto.timingSafeEqual(Buffer.from(recebido),Buffer.from(esperado))) return res.status(401).json({erro:'Não autorizado.'});
  const telefone=num(req.body.whatsapp), clientes=(await db.ref('clientes').once('value')).val()||{}, achado=localizarClienteAtual(clientes, telefone), acao=req.body.acao;
  if(acao==='central_registrar_atendimento'){
    const tipo=String(req.body.tipo||'duvida').slice(0,40),detalhe=String(req.body.detalhe||'').slice(0,180);
    const cliente=achado?.[1]||{};
    await db.ref('centralAtendimentos').push({clienteId:achado?.[0]||'',nome:String(cliente.nome||'Novo atendimento').slice(0,100),whatsapp:telefone,tipo,detalhe,criadoEm:Date.now()});
    return res.json({registrado:true});
  }
  // O catálogo comercial da Central não depende de um cadastro de cliente.
  // Assim, um interessado novo vê apenas os planos ativos — nunca os preços
  // particulares usados nos cadastros manuais do Gestor.
  if(acao==='central_listar_planos'){
    const registros=(await db.ref('centralPlanos').once('value')).val()||{};
    const planos=Object.entries(registros)
      .map(([id,plano])=>({id,nome:String(plano?.nome||'').trim().slice(0,80),valor:Number(plano?.valor),dias:Number(plano?.dias),ativo:plano?.ativo===true}))
      .filter((plano)=>plano.ativo&&plano.nome&&Number.isFinite(plano.valor)&&plano.valor>0&&Number.isInteger(plano.dias)&&plano.dias>0&&plano.dias<=366)
      .sort((a,b)=>a.dias-b.dias||a.valor-b.valor);
    return res.json({planos});
  }
  if(acao==='central_registrar_ativacao'){
    const id=String(req.body.id||''),mac=String(req.body.mac||'').toUpperCase();
    if(!/^[A-F0-9]{2}(?::[A-F0-9]{2}){5}$/.test(mac)||!/^[A-Za-z0-9_-]{6,100}$/.test(id)) return res.status(400).json({erro:'Dados da ativação inválidos.'});
    await db.ref('centralAtivacoes/'+id).set({id,nome:String(req.body.nome||'').trim().slice(0,100)||'Não informado',email:String(req.body.email||'').trim().toLowerCase().slice(0,160),whatsapp:num(req.body.whatsapp),aplicativo:String(req.body.aplicativo||'').trim().slice(0,120),mac,status:String(req.body.status||'aguardando_pagamento').slice(0,40),valor:Number(req.body.valor)||0,criadoEm:Date.now(),atualizadoEm:Date.now()});
    return res.json({registrado:true});
  }
  if(acao==='central_atualizar_ativacao'){
    const id=String(req.body.id||''); if(!/^[A-Za-z0-9_-]{6,100}$/.test(id)) return res.status(400).json({erro:'Ativação inválida.'});
    const existente=(await db.ref('centralAtivacoes/'+id).once('value')).val(); if(!existente) return res.status(404).json({erro:'Ativação não encontrada.'});
    await db.ref('centralAtivacoes/'+id).update({status:String(req.body.status||existente.status).slice(0,40),validade:Number(req.body.validade)||existente.validade||null,atualizadoEm:Date.now()}); return res.json({atualizado:true});
  }
  if(acao==='multiflix_sincronizar_cliente'){
    const origemUid=String(req.body.origemUid||'').trim(),usuario=String(req.body.usuario||'').trim();
    const senha=String(req.body.senha||'').trim(),whatsapp=num(req.body.whatsapp),nome=String(req.body.nome||'').trim().slice(0,100);
    // Alguns acessos virtuais/importados do MultiFlix não carregam a senha
    // no registro administrativo, embora sejam clientes ativos válidos. A
    // ausência desse campo não pode impedir o cadastro no Gestor; quando a
    // senha existir, ela segue sendo sincronizada normalmente.
    if(!origemUid||!/^[A-Za-z0-9._-]{3,100}$/.test(usuario)) return res.status(400).json({erro:'Dados do cliente MultiFlix inválidos.'});
    const clientesAtuais=(await db.ref('clientes').once('value')).val()||{};
    // A chave de origem impede duplicação: o mesmo usuário MultiFlix sempre
    // atualiza o mesmo cliente no Gestor, mesmo quando nome ou WhatsApp mudam.
    const existente=Object.entries(clientesAtuais).find(([,cliente])=>cliente?.origemMultiflixUid===origemUid&&cliente?.origemMultiflixUsuario===usuario)
      || Object.entries(clientesAtuais).find(([,cliente])=>cliente?.origemMultiflixUsuario===usuario)
      || Object.entries(clientesAtuais).find(([,cliente])=>whatsapp&&num(cliente?.whatsapp)===whatsapp&&clienteMultiflix(cliente));
    const clienteId=existente?.[0]||db.ref('clientes').push().key,anterior=existente?.[1]||{};
    const vencimento=Number(req.body.vencimento)||null,agora=Date.now();
    const registro={...anterior,
      nome:nome||anterior.nome||'Cliente MultiFlix',whatsapp:whatsapp||anterior.whatsapp||'',usuario,senha:senha||anterior.senha||'',
      m3uLink:String(req.body.linkM3u||'').slice(0,1200),servidor:String(req.body.servidor||'MultiFlix').slice(0,100),
      valorPlano:String(req.body.valorPlano||'').slice(0,40),tipoPlano:String(req.body.tipoPlano||'').slice(0,80),
      vencimento,status:String(req.body.status||'Ativo').slice(0,60),emTeste:req.body.emTeste===true,bloquearAdulto:req.body.bloquearAdulto===true,
      origemMultiflix:true,origemMultiflixUid:origemUid,origemMultiflixUsuario:usuario,sincronizadoMultiflixEm:agora,
      criadoEm:anterior.criadoEm||agora,atualizadoEm:agora
    };
    await db.ref('clientes/'+clienteId).set(registro);
    return res.json({sincronizado:true,clienteId,criado:!existente});
  }
  if(acao==='multiflix_reverter_lote_sincronizacao'){
    const inicio=Number(req.body.inicioEm),fim=Number(req.body.fimEm);
    // A janela é curta e específica ao lote que a reconciliação retroativa
    // importou indevidamente. Os registros saem da lista operacional, mas
    // ficam arquivados para permitir recuperação, se necessário.
    if(!Number.isFinite(inicio)||!Number.isFinite(fim)||fim<inicio||fim-inicio>6*60*60*1000) return res.status(400).json({erro:'Janela de reversão inválida.'});
    const registros=(await db.ref('clientes').once('value')).val()||{},agora=Date.now(),alteracoes={},ids=[];
    Object.entries(registros).forEach(([id,cliente])=>{
      const sincronizadoEm=Number(cliente?.sincronizadoMultiflixEm)||0;
      if(cliente?.origemMultiflix===true&&sincronizadoEm>=inicio&&sincronizadoEm<=fim){
        alteracoes['clientesRemovidosSincronizacao/'+id]={...cliente,removidoEm:agora,motivoRemocao:'Lote retroativo MultiFlix',removidoPor:'reversao_automatica_lote'};
        alteracoes['clientes/'+id]=null;
        ids.push(id);
      }
    });
    if(ids.length) await db.ref().update(alteracoes);
    return res.json({revertidos:ids.length});
  }
  if(acao==='central_preparar_contratacao_teste'){
    const planoId=String(req.body.planoId||''),nome=String(req.body.nome||'').trim().slice(0,100),email=String(req.body.email||'').trim().toLowerCase().slice(0,160),usuario=String(req.body.usuario||'').trim(),senha=String(req.body.senha||'').trim(),grupoId=String(req.body.grupoId||'').trim().slice(0,100),sessaoHash=String(req.body.sessaoHash||'');
    if(!nome||!emailValido(email)||!/^[A-Za-z0-9._-]{3,100}$/.test(usuario)||!senha||!grupoId||!/^[a-f0-9]{64}$/.test(sessaoHash)) return res.status(400).json({erro:'Não foi possível validar os dados do teste para contratação.'});
    const registros=(await db.ref('centralPlanos').once('value')).val()||{},plano=registros[planoId];
    if(!plano||plano.ativo!==true||!String(plano.nome||'').trim()||!Number.isFinite(Number(plano.valor))||Number(plano.valor)<=0||!Number.isInteger(Number(plano.dias))||Number(plano.dias)<=0||Number(plano.dias)>366) return res.status(400).json({erro:'Esse plano não está disponível agora. Escolha uma opção atualizada.'});
    const contratoId=crypto.randomBytes(20).toString('hex'),referencia='contratacao:'+contratoId;
    const planoSeguro={id:planoId,nome:String(plano.nome).trim().slice(0,80),valor:Number(Number(plano.valor).toFixed(2)),dias:Number(plano.dias)};
    const cobranca=await criarCobrancaPixCentral({referencia,email,valor:planoSeguro.valor,descricao:'Plano MultiFlix — '+planoSeguro.nome});
    const clienteId=crypto.randomBytes(18).toString('hex');
    await db.ref('centralContratacoes/'+contratoId).set({id:contratoId,clienteId,telefone,nome,email,usuario,senha,grupoId,plano:planoSeguro,status:'aguardando_pagamento',paymentId:cobranca.paymentId,sessaoHash,criadoEm:Date.now(),cobranca});
    return res.json({contratacaoId:contratoId,cobranca});
  }
  if(acao==='central_status_contratacao_teste'){
    const id=String(req.body.contratacaoId||''); if(!/^[a-f0-9]{40}$/.test(id)) return res.status(400).json({erro:'Contratação inválida.'});
    const contrato=(await db.ref('centralContratacoes/'+id).once('value')).val();
    if(!contrato||contrato.telefone!==telefone) return res.status(404).json({erro:'Contratação não encontrada.'});
    return res.json({contratacao:{status:String(contrato.status||''),plano:contrato.plano||null,novoVencimento:Number(contrato.novoVencimento||0)||null,usuario:contrato.status==='concluida'?String(contrato.usuario||''):'',senha:contrato.status==='concluida'?String(contrato.senha||''):''}});
  }
  if(!achado)return res.status(404).json({encontrado:false}); const [,c]=achado;
  const apps=(await db.ref('aplicativos').once('value')).val()||{};
  // Renovação por comprovante foi desativada: somente pagamentos criados
  // pela Central via Mercado Pago podem concluir renovação automática.
  if(acao==='central_renovar_comprovante') return res.status(410).json({aceito:false,erro:'A renovação por comprovante não está disponível. Use o Pix gerado pela Central.'});
  if(acao==='central_renovar_comprovante'){
    if(!clienteMultiflix(c)||!c.usuario) return res.status(409).json({aceito:false,erro:'Este acesso não é elegível para renovação automática por comprovante.'});
    const comprovante=req.body.comprovante||{}, valor=Number(comprovante.valor), status=normalizar(comprovante.status);
    const transacao=String(comprovante.transacao||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,120);
    if(!destinatarioAceito(comprovante.destinatario,comprovante.banco)||!Number.isFinite(valor)||valor<=0||!/(?:EFETIVADO|CONCLUIDO|APROVADO|PIX ENVIADO)/.test(status)||transacao.length<6) return res.status(409).json({aceito:false,erro:'Não consegui validar este comprovante para renovação automática.'});
    const consulta=await consultarRenovacaoMultiflix(c.usuario);
    if(!consulta?.encontrado||!consulta.plano||Math.abs(Number(consulta.plano.valor)-valor)>0.009) return res.status(409).json({aceito:false,erro:'O valor do comprovante não corresponde ao plano atual deste acesso.'});
    const pagamentoId='comprovante_'+crypto.createHash('sha256').update(transacao+'|'+telefone+'|'+valor).digest('hex').slice(0,48);
    const renovacao=await renovarNoMultiflix(c.usuario,pagamentoId);
    const pendenciaId=crypto.createHash('sha256').update(pagamentoId).digest('hex').slice(0,40);
    await db.ref('centralPendenciasComprovante/'+pendenciaId).set({id:pendenciaId,clienteId:achado[0],nome:String(c.nome||'Cliente').slice(0,100),whatsapp:telefone,usuario:c.usuario,plano:consulta.plano,valor,comprovante:{destinatario:normalizar(comprovante.destinatario),banco:normalizar(comprovante.banco),dataHora:String(comprovante.dataHora||'').slice(0,80),status:normalizar(comprovante.status),transacao,imagemHash:String(req.body.imagemHash||'').slice(0,64)},novoVencimento:Number(renovacao.novoVencimento||0)||null,status:'renovado_pendente_validacao',resolvido:false,criadoEm:Date.now()});
    await db.ref('centralContratacoes/'+pendenciaId).set({id:pendenciaId,nome:String(c.nome||'Cliente').slice(0,100),whatsapp:telefone,usuario:c.usuario,plano:consulta.plano,status:'renovado_pendente_validacao',paymentId:transacao,valor,novoVencimento:Number(renovacao.novoVencimento||0)||null,detalhe:'Renovação automática por comprovante — aguarda validação humana',criadoEm:Date.now(),resolvido:false});
    return res.json({aceito:true,novoVencimento:renovacao.novoVencimento||null,pendenciaId});
  }
  if(acao==='central_perfil') {
    // Um registro antigo no Gestor não pode fazer a Central reconhecer como
    // ativo um acesso MultiFlix que já foi apagado. Só reclassificamos quando
    // o próprio MultiFlix confirma "não encontrado"; falhas de rede mantêm o
    // cadastro protegido como está.
    if(clienteMultiflix(c) && c.usuario) {
      const multi=await consultarRenovacaoMultiflix(c.usuario).catch(()=>null);
      if(multi?.encontrado===false) return res.json({encontrado:false,acessoEncerrado:true});
    }
    return res.json({encontrado:true,perfil:{nome:c.nome||'Cliente',status:c.status||'',servidor:c.servidor||'',vencimento:c.vencimento||null,plano:{nome:String(c.tipoPlano||c.plano||'').slice(0,80),valor:Number(c.valorPlano||c.planoValor||0)||0},aplicativos:appsDoCliente(c,apps).map((app)=>app.nome),temDadosAcesso:!!(c.usuario||c.senha||c.m3uLink),temEmailCadastrado:!!emailValido(c.email),emailVerificado:!!(c.email&&c.emailVerificadoEm),multiflix:clienteMultiflix(c),areaClienteUrl:clienteMultiflix(c)?'https://x.fenixsocial.site/cliente.html':''}});
  }
  if(acao==='central_consultar_renovacao'){
    if(!clienteMultiflix(c)) return res.json({automatico:false,mensagem:'💬 Vamos ajudar com sua renovação\n\nNo momento, as renovações deste serviço são realizadas diretamente pelo nosso atendimento no WhatsApp.\n\nAssim conseguimos conferir as opções disponíveis para a sua conta e orientar você da melhor forma. 😊'});
    if(!c.usuario) return res.status(409).json({erro:'Não localizei o usuário MultiFlix desta conta para consultar a renovação.'});
    const consulta=await consultarRenovacaoMultiflix(c.usuario);
    if(!consulta?.encontrado||!consulta.plano) return res.status(409).json({erro:'Não consegui localizar o plano MultiFlix desta conta agora. Fale com nosso suporte pelo WhatsApp.'});
    const ofertaId=crypto.randomBytes(20).toString('hex'),expiraEm=Date.now()+15*60*1000;
    await db.ref('centralRenovacoes/'+ofertaId).set({clienteId:achado[0],telefone,usuario:c.usuario,plano:consulta.plano,expiraEm,criadoEm:Date.now()});
    return res.json({automatico:true,oferta:{token:ofertaId,plano:consulta.plano}});
  }
  if(acao==='central_status_renovacao'){
    const renovacaoId=String(req.body.renovacaoId||'');
    if(!/^[a-f0-9]{40}$/.test(renovacaoId)) return res.status(400).json({erro:'Renovação inválida.'});
    const renovacao=(await db.ref('renovacoes/'+renovacaoId).once('value')).val();
    if(!renovacao||renovacao.clienteId!==achado[0]) return res.status(404).json({erro:'Renovação não encontrada.'});
    return res.json({renovacao:{status:String(renovacao.status||''),novoVencimento:Number(renovacao.novoVencimento||0)||null,emailEnviado:renovacao.emailEnviado===true}});
  }
  if(acao==='central_gerar_cobranca_renovacao'){
    const ofertaId=String(req.body.oferta||''),ofertaRef=db.ref('centralRenovacoes/'+ofertaId),oferta=(await ofertaRef.once('value')).val();
    if(!/^[a-f0-9]{40}$/.test(ofertaId)||!oferta||oferta.clienteId!==achado[0]||oferta.expiraEm<Date.now()) return res.status(401).json({erro:'Essa oferta expirou. Solicite a renovação novamente para consultar o plano atualizado.'});
    if(oferta.cobranca?.copiaCola) return res.json({cobranca:oferta.cobranca,reutilizada:true});
    const renovacaoId=crypto.randomBytes(20).toString('hex'),referencia='renovacao:'+renovacaoId;
    const cobranca=await criarCobrancaPixCentral({referencia,email:c.email,valor:oferta.plano.valor,descricao:'Renovação MultiFlix — '+oferta.plano.nome});
    const sessaoHash=/^[a-f0-9]{64}$/.test(String(req.body.sessaoHash||''))?String(req.body.sessaoHash):'';
    const registro={clienteId:achado[0],telefone,usuario:oferta.usuario,plano:oferta.plano,valor:oferta.plano.valor,status:'aguardando_pagamento',criadoEm:Date.now(),paymentId:cobranca.paymentId,sessaoHash};
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
    const acao = String(req.body?.acao || '');
    // A sincronização parte do MultiFlix, mas usa a mesma integração
    // autenticada da Central. Sem esta entrada, ela caía na rota genérica
    // de consulta e era rejeitada como se faltasse um link de IPTV.
    if (acao.startsWith('central_') || acao === 'multiflix_sincronizar_cliente' || acao === 'multiflix_reverter_lote_sincronizacao') {
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
