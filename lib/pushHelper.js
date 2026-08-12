// Envia push com segurança: se o token estiver expirado/inválido, desativa
// a notificação sozinho no cadastro do cliente — assim, da próxima vez que
// ele abrir a página, o botão "Ativar notificações" aparece de novo.

const CODIGOS_TOKEN_INVALIDO = [
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
];

async function enviarPushSeguro({ messaging, db, caminhoRegistro, token, payload }) {
  try {
    await messaging.send({ token, data: payload });
    return { enviado: true };
  } catch (err) {
    if (CODIGOS_TOKEN_INVALIDO.includes(err.code)) {
      try {
        await db.ref(caminhoRegistro).update({ notificacaoAtiva: false, fcmToken: null });
      } catch (e) {}
      return { enviado: false, tokenInvalido: true, motivo: err.message };
    }
    return { enviado: false, tokenInvalido: false, motivo: err.message };
  }
}

module.exports = { enviarPushSeguro };
