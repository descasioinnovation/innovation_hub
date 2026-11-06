        // --- EmailJS Initialization ---
        emailjs.init("LF76ppQ83bSQ3ggtK");
        // --- Firebase Configuration ---
        const firebaseConfig = {
            apiKey: "AIzaSyBrRmGnPm3WcK2GKQqN_lAEvJJZPgXVdxw",
            authDomain: "ai-innovation-hub-submissions.firebaseapp.com",
            projectId: "ai-innovation-hub-submissions",
            storageBucket: "ai-innovation-hub-submissions.firebasestorage.app",
            messagingSenderId: "965178905775",
            appId: "1:965178905775:web:d4741ca8f16bd242b5705a"
        };
        firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth();
        const db = firebase.firestore();
