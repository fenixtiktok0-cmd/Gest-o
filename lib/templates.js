function formatarData(timestamp) {
  return new Date(timestamp).toLocaleDateString('pt-BR');
}

function preencherTemplate(template, cliente) {
  const diasRestantes = Math.ceil(
    (cliente.vencimento - Date.now()) / (1000 * 60 * 60 * 24)
  );

  return template
    .replaceAll('{nome}', cliente.nome || '')
    .replaceAll('{data_vencimento}', formatarData(cliente.vencimento))
    .replaceAll('{valor_plano}', (cliente.planoValor || 0).toFixed(2))
    .replaceAll('{servidor}', cliente.servidor || '')
    .replaceAll('{dias_restantes}', String(diasRestantes))
    .replaceAll('{status}', cliente.status || '');
}

const TEMPLATES_PADRAO = {
  msg3dias:
    'Olá {nome}! Seu plano vence em {dias_restantes} dias ({data_vencimento}). Valor: R$ {valor_plano}. Quer renovar agora?',
  msgVencimento:
    'Olá {nome}! Seu plano vence hoje ({data_vencimento}). Valor: R$ {valor_plano}. Renova pra não perder o acesso?',
  msgVencido:
    'Olá {nome}! Seu plano venceu em {data_vencimento}. Valor: R$ {valor_plano}. Vamos regularizar?',
  emailAssunto: 'Seu plano vence em breve',
  emailCorpo:
    'Olá {nome},\n\nSeu plano ({servidor}) vence em {data_vencimento}. Valor: R$ {valor_plano}.\n\nQualquer dúvida, chama no WhatsApp.',
};

module.exports = { preencherTemplate, TEMPLATES_PADRAO, formatarData };
