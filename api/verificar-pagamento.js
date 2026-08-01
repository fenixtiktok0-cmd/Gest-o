const { consultarPagamento } = require('../lib/mercadopago');

module.exports = async (req, res) => {
  try {
    const { paymentId } = req.query;
    if (!paymentId) return res.status(400).json({ erro: 'paymentId é obrigatório' });

    const pagamento = await consultarPagamento(paymentId);
    return res.status(200).json({ status: pagamento.status });
  } catch (err) {
    console.error('Erro em /api/verificar-pagamento:', err);
    return res.status(500).json({ erro: 'Erro interno' });
  }
};
