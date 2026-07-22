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
  msg7dias:
    'Olá {nome}! Passando pra lembrar que seu plano vence em {dias_restantes} dias ({data_vencimento}). Valor: R$ {valor_plano}.',
  msg3dias:
    'Olá {nome}! Seu plano vence em {dias_restantes} dias ({data_vencimento}). Valor: R$ {valor_plano}. Quer renovar agora?',
  msgVencimento:
    'Olá {nome}! Seu plano vence hoje ({data_vencimento}). Valor: R$ {valor_plano}. Renova pra não perder o acesso?',
  msg3diasVencido:
    'Olá {nome}! Seu plano venceu há 3 dias ({data_vencimento}). Valor: R$ {valor_plano}. Vamos regularizar hoje?',
  msgVencido:
    'Olá {nome}! Seu plano venceu em {data_vencimento}. Valor: R$ {valor_plano}. Vamos regularizar?',
  msgManual:
    'Olá {nome}! Passando aqui sobre o seu plano ({servidor}), vencimento em {data_vencimento}. Qualquer coisa me chama!',
  comprovanteRenovacao:
    'Olá {nome}! Seu plano foi renovado com sucesso ✅\nNovo vencimento: {data_vencimento}\nValor: R$ {valor_plano}\nObrigado pela confiança!',
  emailAssunto: 'Seu plano vence em breve',
  emailCorpo:
    'Olá {nome},\n\nSeu plano ({servidor}) vence em {data_vencimento}. Valor: R$ {valor_plano}.\n\nQualquer dúvida, chama no WhatsApp.',
};

module.exports = { preencherTemplate, TEMPLATES_PADRAO, formatarData };
