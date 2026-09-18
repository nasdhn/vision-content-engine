# 09 — Product Capture with Playwright

## But
Créer automatiquement de vraies démos Vision reproductibles.

## Principe
Le LLM peut proposer un scénario.
L'exécution est déterministe.

## Exemple
Scenario: restaurants sans site à Lyon

1. ouvrir environnement contrôlé Vision ;
2. naviguer vers Agent ;
3. saisir une requête définie ;
4. lancer ;
5. attendre un état attendu ;
6. capturer étapes / écrans ;
7. produire assets vidéo/screenshot ;
8. transmettre au montage.

## Sécurité
- préférer environnement de démo / staging ;
- éviter navigation libre en production ;
- scénarios whitelistés ;
- comptes dédiés ;
- timeouts et assertions ;
- logs et screenshots d'échec ;
- aucune action destructive.

## À définir avant code
- environnement cible ;
- données reproductibles ;
- auth dédiée ;
- stratégies de capture ;
- nettoyage des runs.
