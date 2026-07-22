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

// Notificações recebidas com o app/aba fechada aparecem automaticamente
// via messaging.onBackgroundMessage — o Firebase já cuida disso por padrão
// quando o payload tem o campo "notification".
