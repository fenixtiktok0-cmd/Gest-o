const { consultarContaXtream } = require('../lib/xtream');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ erro: `Método ${req.method} não permitido` });
  }

  try {
    const { link } = req.body || {};
    if (!link) {
      return res.status(400).json({ erro: 'link é obrigatório' });
    }

    const resultado = await consultarContaXtream(link);
    if (resultado.erro) {
      return res.status(422).json(resultado);
    }

    return res.status(200).json(resultado);
  } catch (err) {
    console.error('Erro em /api/consultar-iptv:', err);
    return res.status(500).json({ erro: 'Erro interno ao consultar o painel' });
  }
};
