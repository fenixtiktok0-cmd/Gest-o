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

// Assumimos o controle total da notificação em segundo plano, pra garantir
// que o link customizado (data.link) chegue certinho até o clique —
// o comportamento automático do Firebase guarda isso numa estrutura interna
// que nem sempre é acessível do jeito simples.
messaging.onBackgroundMessage(function (payload) {
  const titulo = payload.data?.title || 'Aviso';
  const opcoes = {
    body: payload.data?.body || '',
    data: { link: payload.data?.link || '' },
  };
  self.registration.showNotification(titulo, opcoes);
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const link = event.notification?.data?.link;
  if (link) {
    event.waitUntil(clients.openWindow(link));
  }
});
