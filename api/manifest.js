module.exports = async (req, res) => {
  const clienteId = req.query.id || '';
  const startUrl = clienteId ? `/meu-plano.html?id=${clienteId}` : '/meu-plano.html';

  const manifest = {
    name: 'Meu Plano',
    short_name: 'Meu Plano',
    description: 'Acompanhe seu plano, ative notificações e veja seus dados de acesso.',
    start_url: startUrl,
    display: 'standalone',
    background_color: '#0B0F14',
    theme_color: '#34D399',
    orientation: 'portrait',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };

  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(manifest);
};
