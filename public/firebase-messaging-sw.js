importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBaVUpfN03wm2mm_C3sUZhMUZtThb32FSQ",
  authDomain: "gestao-clientes-a1664.firebaseapp.com",
  databaseURL: "https://gestao-clientes-a1664-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "gestao-clientes-a1664",
  storageBucket: "gestao-clientes-a1664.firebasestorage.app",
  messagingSenderId: "417549104013",
  appId: "1:417549104013:web:0a753604b6eaf2f65243c4"
});

const messaging = firebase.messaging();

// Assumimos o controle total da notificação em segundo plano — isso garante
// que o campo "data.link" chega certinho até o clique, sem depender da
// estrutura interna que o Firebase usa quando exibe a notificação sozinho.
messaging.onBackgroundMessage(function (payload) {
  try {
    const titulo = payload.data?.title || 'Aviso sobre seu plano';
    const opcoes = {
      body: payload.data?.body || '',
      data: { link: payload.data?.link || '' },
    };
    return self.registration.showNotification(titulo, opcoes);
  } catch (err) {
    // Garante que SEMPRE aparece alguma notificação, mesmo se algo
    // inesperado acontecer acima — evita o aviso genérico do Chrome
    // ("este site foi atualizado em segundo plano").
    return self.registration.showNotification('Aviso sobre seu plano', {
      body: 'Você tem uma atualização. Abra o app pra ver.',
    });
  }
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const link = event.notification?.data?.link;
  if (link) {
    event.waitUntil(clients.openWindow(link));
  }
});
