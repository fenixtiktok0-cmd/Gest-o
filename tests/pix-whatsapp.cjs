const {test} = require('node:test');
const assert = require('node:assert/strict');
const {criarAvisos, telefone, enviar, INICIO} = require('../lib/pix-whatsapp');
const PEDIDO = '12345678-1234-1234-1234-123456789abc';
function banco() {
  const data = {clientes:{c1:{nome:'Cliente teste',usuario:'teste',whatsapp:'21999990000',vencimento:INICIO+999999999,pixAreaConfirmacoes:{[PEDIDO]:{pagamentoId:'p1',vencimento:INICIO+999999999}}}},config:{whatsappAdmin:'5521888880000'}};
  function ref(path) {
    const partes = path.split('/');
    const get = () => partes.reduce((a,k)=>a?.[k],data) ?? null;
    const put = v => { let a=data; for (const k of partes.slice(0,-1)) a=a[k]??={}; if(v===null) delete a[partes.at(-1)]; else a[partes.at(-1)]=structuredClone(v); };
    const snap = v => ({val:()=>structuredClone(v)});
    return {
      once:async()=>snap(get()),set:async v=>put(v),remove:async()=>put(null),update:async v=>put({...get(),...v}),
      transaction:async fn=>{const v=fn(structuredClone(get()));if(v===undefined)return{committed:false,snapshot:snap(get())};put(v);return{committed:true,snapshot:snap(get())};},
      orderByKey(){return this;},limitToFirst(){return this;}
    };
  }
  return {data,ref};
}
function setup(outcomes=['enviado','enviado']) {
  const db=banco(), sends=[], waits=[]; let tempo=INICIO+10000;
  const svc=criarAvisos({db,env:{TEXTMEBOT_APIKEY:'FAKE'},agora:()=>tempo,pausa:async ms=>{waits.push(ms);tempo+=ms;},enviarImpl:async p=>{sends.push(p);return outcomes.shift()||'enviado';}});
  const origem={confirmado:true,pagamentoId:'p1',concluidoEm:INICIO+1,novoVencimento:INICIO+999999999,plano:{nome:'Mensal',valor:25}};
  return {db,svc,sends,waits,origem};
}
test('envia uma vez para cada destinatário, sem senha e com espaçamento',async()=>{
  const s=setup(); await Promise.all([s.svc.enfileirar('c1',PEDIDO,s.origem),s.svc.enfileirar('c1',PEDIDO,s.origem)]);
  await Promise.all([s.svc.processar(),s.svc.processar()]);
  await s.svc.enfileirar('c1',PEDIDO,s.origem); await s.svc.processar();
  assert.equal(s.sends.length,2); assert.deepEqual(s.waits,[6000]);
  assert.equal(s.sends[0].numero,'5521999990000'); assert.equal(s.sends[1].numero,'5521888880000');
  assert.match(s.sends[0].texto,/Novo vencimento/); assert.match(s.sends[1].texto,/R\$\s*25,00/);
  assert.ok(s.sends.every(p=>!p.texto.includes('senha')));
  assert.equal(s.db.data.clientes.c1.vencimento,INICIO+999999999);
});
test('não avisa pagamentos antigos, não confirmados ou recibo divergente',async()=>{
  for(const change of [{concluidoEm:INICIO-1},{confirmado:false},{pagamentoId:'outro'}]){
    const s=setup();await s.svc.enfileirar('c1',PEDIDO,{...s.origem,...change});await s.svc.processar();assert.equal(s.sends.length,0);
  }
});
test('falha cliente não impede admin; resposta ambígua não é reenviada',async()=>{
  const s=setup(['inconclusivo','enviado']);await s.svc.enfileirar('c1',PEDIDO,s.origem);await s.svc.processar();await s.svc.processar();
  assert.equal(s.sends.length,2);
  assert.equal(s.db.data.clientes.c1.pixAreaConfirmacoes[PEDIDO].whatsapp.cliente,'inconclusivo');
  assert.equal(s.db.data.clientes.c1.pixAreaConfirmacoes[PEDIDO].whatsapp.admin,'enviado');
});
test('sem chave mantém fila e sem número não envia para outro cliente',async()=>{
  const s=setup();await s.svc.enfileirar('c1',PEDIDO,s.origem);
  await criarAvisos({db:s.db,env:{},enviarImpl:async()=>assert.fail('não deveria enviar')}).processar();
  assert.ok(s.db.data.pixWhatsappPendentes[PEDIDO]);
  s.db.data.clientes.c1.whatsapp='';await s.svc.processar();assert.equal(s.sends.length,1);assert.equal(s.sends[0].numero,'5521888880000');
});
test('envio interrompido não repete mensagem',async()=>{
  const s=setup();await s.svc.enfileirar('c1',PEDIDO,s.origem);
  s.db.data.clientes.c1.pixAreaConfirmacoes[PEDIDO].whatsapp.cliente='enviando';
  await s.svc.processar();assert.equal(s.sends.length,1);
  assert.equal(s.db.data.clientes.c1.pixAreaConfirmacoes[PEDIDO].whatsapp.cliente,'inconclusivo');
});
test('sender usa POST sem chave na URL e exige confirmação explícita',async()=>{
  for(const [dados,expected] of [[{status:'success'},'enviado'],[{status:'error'},'recusado'],[{},'inconclusivo']]) {
    const resultado=await enviar({numero:'5521999990000',texto:'teste',chave:'segredo',fetchImpl:async(url,opts)=>{
      assert.ok(!url.includes('segredo'));assert.equal(opts.method,'POST');assert.equal(new URLSearchParams(opts.body).get('apikey'),'segredo');
      return{ok:true,text:async()=>JSON.stringify(dados)};
    }});assert.equal(resultado,expected);
  }
  assert.equal(await enviar({fetchImpl:async()=>{throw Error('timeout');}}),'inconclusivo');
});
test('normalização brasileira',()=>{assert.equal(telefone('(21) 99999-0000'),'5521999990000');assert.equal(telefone('x'),'');});
