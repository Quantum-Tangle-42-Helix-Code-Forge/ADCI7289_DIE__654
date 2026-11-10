
📋 Résumé du rôle de vos fichiers


Fichier	   | Nom technique probable	    |   Rôle principal
...........|-**********************-----|   **************
...........|----------------------------|
...........|----------------------------|
Fichier 1  |   checkout-session / init	|	Intercepte la demande d'achat initiale de l'utilisateur, vérifie son authentification Supabase,
...........|---***********************--|	génère un jeton temporaire et l'enregistre dans la table checkout_sessions pour sécuriser 
...........|----------------------------|	l'accès à la page finale d'achat.
...........|----------------------------|
...........|----------------------------|
...........|----------------------------|
Fichier 2  |	paddle-webhook	        |	Écoute les notifications asynchrones envoyées par Paddle (Transaction réussie, annulée, échouée).
...........|----***************---------|	valide la signature de sécurité, puis crédite le portefeuille (wallet_transactions) ou 
...........|----------------------------|	les objets (item_purchases) dans votre base de données.
...........|----------------------------|
...........|----------------------------|
...........|----------------------------|
Fichier 3  |   create-transaction	    |	C'est le fichier central de communication avec Paddle.
...........|---******************-------|	Il crée l'intention de paiement en base de données,
...........|----------------------------|	puis appelle directement l'API de Paddle pour générer l'ID de transaction et l'URL du tunnel de paiement 
...........|----------------------------|	(checkout_url).



