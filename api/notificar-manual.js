const { db, messaging } = require('../lib/firebaseAdmin');
const { preencherTemplate, TEMPLATES_PADRAO } = require('../lib/templates');
const { enviarPushSeguro } = require('../lib/pushHelper');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ erro: `Método ${req.method} não permitido` });
  }

  try {
    const { clienteIds, mensagemCustom } = req.body || {};
    if (!Array.isArray(clienteIds) || clienteIds.length === 0) {
      return res.status(400).json({ erro: 'clienteIds é obrigatório (array)' });
    }

    const configSnap = await db.ref('config').once('value');
    const config = configSnap.val() || {};
    const templates = config.templates || {};
    const whatsappAdmin = config.whatsappAdmin;

    const resultados = [];

    for (const id of clienteIds) {
      const clienteSnap = await db.ref(`clientes/${id}`).once('value');
      const cliente = clienteSnap.val();

      if (!cliente) {
        resultados.push({ id, enviado: false, motivo: 'cliente não encontrado' });
        continue;
      }

      const chaveManual = cliente.musica ? 'msgManualMusica' : 'msgManual';
      // Se o template não foi personalizado (templates[chaveManual] vazio/undefined),
      // usa o texto padrão em vez de mandar mensagem vazia.
      const templateBase = templates[chaveManual] || TEMPLATES_PADRAO.msgManual;
      const corpo = mensagemCustom
        ? preencherTemplate(mensagemCustom, cliente, id)
        : preencherTemplate(templateBase, cliente, id);

      let pushEnviado = false;
      let pushMotivo = 'sem token FCM';
      if (cliente.fcmToken) {
        const linkClique = `${process.env.APP_URL}/meu-plano.html?id=${id}`;
        const resultadoPush = await enviarPushSeguro({
          messaging,
          db,
          caminhoRegistro: `clientes/${id}`,
          token: cliente.fcmToken,
          payload: {
            title: 'Aviso sobre seu plano',
            body: corpo,
            link: linkClique,
          },
        });
        pushEnviado = resultadoPush.enviado;
        pushMotivo = resultadoPush.tokenInvalido
          ? 'token expirado — notificação desativada, cliente precisa ativar de novo'
          : (resultadoPush.motivo || null);
      }

      let emailEnviado = false;
      let emailMotivo = 'cliente não tem e-mail cadastrado';
      if (cliente.email) {
        try {
          const chaveAssunto = cliente.musica ? 'emailAssuntoMusica' : 'emailAssunto';
          const assuntoBase = templates[chaveAssunto] || TEMPLATES_PADRAO.emailAssunto;
          const resultadoEmail = await resend.emails.send({
            from: process.env.RESEND_FROM,
            to: cliente.email,
            subject: preencherTemplate(assuntoBase, cliente, id),
            text: corpo,
          });
          emailEnviado = !resultadoEmail.error;
          emailMotivo = emailEnviado ? null : (resultadoEmail.error?.message || 'falha ao enviar pelo provedor de e-mail');
        } catch (err) {
          emailMotivo = 'erro inesperado ao tentar enviar';
        }
      }

      if (pushEnviado || emailEnviado) {
        await db.ref(`clientes/${id}/ultimaNotificacao`).set({
          tipo: 'manual',
          data: Date.now(),
        });
      }

      resultados.push({
        id,
        enviado: pushEnviado || emailEnviado,
        pushEnviado,
        emailEnviado,
        motivo: pushMotivo,
        emailMotivo,
      });
    }

    return res.status(200).json({ resultados });
  } catch (err) {
    console.error('Erro em /api/notificar-manual:', err);
    return res.status(500).json({ erro: 'Erro interno' });
  }
};
