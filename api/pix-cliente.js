const { db } = require('../lib/firebaseAdmin');
const { criarPagamentoPix, consultarPagamento } = require('../lib/mercadopago');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const { paymentId } = req.query;
      if (!paymentId) return res.status(400).json({ erro: 'paymentId é obrigatório' });
      const pagamento = await consultarPagamento(paymentId);
      return res.status(200).json({ status: pagamento.status });
    }

    if (req.method === 'POST') {
      const { clienteId } = req.body || {};
      if (!clienteId) return res.status(400).json({ erro: 'clienteId é obrigatório' });

      const clienteSnap = await db.ref(`clientes/${clienteId}`).once('value');
      const cliente = clienteSnap.val();
      if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado' });
      if (!cliente.planoValor || cliente.planoValor <= 0) {
        return res.status(400).json({ erro: 'Esse cliente não tem valor especial definido ainda' });
      }

      const pix = await criarPagamentoPix({
        clienteId,
        email: cliente.email,
        valor: cliente.planoValor,
        descricao: `Ativação do plano — ${cliente.nome}`,
      });

      await db.ref(`clientes/${clienteId}`).update({
        statusLead: 'pagamento_pendente',
        ultimoPagamentoId: pix.paymentId,
      });

      return res.status(200).json({
        ok: true,
        paymentId: pix.paymentId,
        qrCodeBase64: pix.qrCodeBase64,
        qrCodeTexto: pix.qrCodeTexto,
        valor: cliente.planoValor,
      });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ erro: `Método ${req.method} não permitido` });
  } catch (err) {
    console.error('Erro em /api/pix-cliente:', err);
    return res.status(500).json({ erro: err.message || 'Erro interno' });
  }
};
