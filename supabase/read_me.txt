1. À quoi sert chacune de vos  tables et qui écrit dedans ?

Voici le rôle exact de votre architecture :

[Jeu / Web]
               │
               ▼  (1. create-checkout)
    ┌──────────────────────┐
    │   payment_intents    │  <-- Registre d'intention (status: "initiated")
    └──────────────────────┘
               │
               ▼  (2. Le joueur paye sur la fenêtre Paddle)
        [Paddle Webhook]
               │  (3. paddle-webhook valide le paiement et met status: "completed")
       ┌───────┴────────────────────────┐
       ▼                                ▼
┌──────────────────────┐     ┌──────────────────────┐
│ wallet_transactions  │     │   item_purchases     │
│ (Livre de comptes)   │     │ (File de livraison)  │
└──────────────────────┘     └──────────────────────┘
                                        │
                                        ▼ (4. WebSocket Godot détecte la ligne)
                                  [Donne l'item au joueur en direct]

##############################################################################################""""""""""
payment_intents :

Rôle : Journalise la tentative d'achat avant que la popup Paddle ne s'ouvre.

Qui écrit dedans ? D'abord create-checkout (crée la ligne avec status: 'initiated'),
puis paddle-webhook (la passe en status: 'completed' et date avec completed_at).

##############################################################################################""""""""""
wallet_transactions :
Rôle : Grand livre comptable financier. Il stocke l'historique de chaque centime / monnaie virtuelle crédité.

Qui écrit dedans ? Exclusivement paddle-webhook après validation bancaire.

##############################################################################################""""""""""
item_purchases :

Rôle : File d'attente des récompenses à distribuer dans le jeu.

Qui écrit dedans ? paddle-webhook avec delivered: false.
Qui le lit ? Votre script Godot WebsocketForRealTime.txt écoute cette table en direct via WebSocket. 
Dès qu'une ligne apparaît avec delivered: false, Godot donne l'objet au joueur (achat_temps_reel_recu.emit) et passe le statut à delivered = true.
