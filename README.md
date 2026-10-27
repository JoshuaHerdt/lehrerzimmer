# Lehrerzimmer Arena

Das Sammelkartenspiel der FOS Holzkirchen – spielbar im Browser, gegen den Computer oder live gegen andere.

**Spielen:** https://joshuaherdt.github.io/lehrerzimmer/

- Hauptmenü mit Start, Spielen, Decks, Packs, Album und Regeln
- 4 Zweige der FOS als Fraktionen, Ideen aus Gwent, 3D-Klassenzimmer aus Blender
- Online-Partien über Firebase Realtime Database (kostenloser Spark-Tarif)

## Online-Modus einrichten (einmalig)
1. https://console.firebase.google.com → Projekt hinzufügen (Google Analytics nicht nötig).
2. Build → Authentication → Erste Schritte → Anmeldeanbieter **Anonym** aktivieren.
3. Build → Realtime Database → Datenbank erstellen → Standort **europe-west1** → im **gesperrten Modus** starten.
4. Realtime Database → Regeln → Inhalt von `database.rules.json` einfügen → Veröffentlichen.
5. Projekteinstellungen → Meine Apps → Web-App (`</>`) hinzufügen → die angezeigte `firebaseConfig` in `config.js` eintragen.
