#!/usr/bin/env bash
# rg-watchdog.sh — auto-réparation générique d'un service HTTP de production.
#
# POURQUOI CE SCRIPT EST GÉNÉRIQUE
# `Restart=always` ne couvre que les crashs : il ne voit pas le cas « process vivant
# mais figé » (thrash mémoire, boucle d'événements bloquée) qui produit un 504
# persistant. Un watchdog existait pour ça, mais pour azalée seule — l'audit du
# 14/8/2026 a compté treize autres services de production sans aucune sonde de santé,
# dont nie-model-serve, précisément celui qui sortait en code 0 puis répondait 502.
# La logique était déjà bonne ; seules l'unité, le port et le seuil étaient figés.
# Ils sont désormais lus dans la table ci-dessous, et systemd instancie un timer par
# service (`rg-watchdog@<service>.timer`).
#
# CE QU'IL FAIT
#   - sonde 3× la santé du service ; redémarre si 3/3 échouent (000/502/503/504),
#   - redémarre si 3/3 répondent mais TROP LENTEMENT, et seulement si la mémoire du
#     cgroup corrobore (voir « le 200 en douze secondes » ci-dessous),
#   - redémarre si le cgroup passe son temps bloqué à attendre de la mémoire (PSI),
#   - redémarre préventivement (SIGTERM propre) si la RAM du cgroup approche MemoryMax,
#   - relance le service s'il est simplement arrêté,
#   - ne fait RIEN pendant un déploiement, ni pendant un redémarrage déjà en cours,
#     ni sur une 5xx applicative (500 = application vivante mais fautive : un
#     redémarrage bouclerait sans corriger un mauvais build),
#   - refuse de boucler : au-delà de trois redémarrages en trente minutes il se tait et
#     laisse la place à un humain, parce qu'un quatrième n'aurait rien corrigé.
#
# LE 200 EN DOUZE SECONDES (incident du 21/8/2026, rosegriffon.fr)
# `website-web` a servi /community et /chroniques en **onze secondes** pendant plusieurs
# jours, avec des « Connection terminated due to connection timeout » en boucle sur un
# Postgres local pourtant à 0,05 s. Cause : 2,68 Gio de RSS contre `MemoryHigh=2560M`,
# donc un cgroup étranglé en permanence par le noyau — `memory.pressure` annonçait
# `full avg300=33,98 %`, soit un tiers du temps où AUCUN processus du service ne pouvait
# avancer. Un processus neuf sur le même build répondait en 0,08 s.
# Le watchdog a regardé cette panne pendant quatre jours sans rien voir, pour deux
# raisons cumulées :
#   1. son seuil mémoire valait 85 % de **MemoryMax** (3,4 Gio) alors que la falaise est
#      **MemoryHigh** (2,5 Gio) — le noyau étrangle dès `high`, il ne tue qu'à `max` ;
#      le service vivait donc en permanence dans l'intervalle où il est déjà cassé mais
#      pas encore surveillé ;
#   2. sa seule sonde applicative était le code HTTP, et un 200 lent est un 200.
# D'où les deux mesures ajoutées ici — la pression mémoire du cgroup et la latence de la
# sonde — et un seuil mémoire désormais **calculé depuis systemd** au lieu d'être recopié
# à la main dans la table (une valeur recopiée finit toujours par mentir sur l'unité
# qu'elle prétend décrire).
#
# POURQUOI PAS « MÉMOIRE HAUTE = PANNE »
# `nie-model-serve` vit collé à son `MemoryHigh` (7,8 Gio sur 8) avec `full avg300=0 %`
# et un /health à 0,4 ms : ses pages sont des CPK projetés en mémoire, que le noyau
# récupère sans coût. Redémarrer sur la seule hauteur de RSS le relancerait toutes les
# heures pour rien. C'est la **pression**, pas l'occupation, qui distingue le service
# étranglé du service simplement gros.
#
# Usage : rg-watchdog.sh <nom-du-service-sans-.service>
set -uo pipefail

CIBLE="${1:-}"
[ -n "$CIBLE" ] || { echo "usage: rg-watchdog.sh <service>" >&2; exit 2; }

# Table de surveillance : service | port | seuil mémoire de SECOURS (Gio) | chemin de
# santé | dossier de versions (bleu/vert) s'il y en a un.
#
# Le seuil de la table ne sert plus que de filet quand l'unité n'impose aucune limite
# mémoire : sinon il est recalculé sur `MemoryMax` (85 %), à défaut sur `MemoryHigh`
# (90 %), directement depuis systemd.
case "$CIBLE" in
	rg-website)      PORT=3004; SEUIL_GIB=3.4; SANTE="/api/health"; RELEASES="" ;;
	nie-model-serve) PORT=8790; SEUIL_GIB=8.5; SANTE="/health"; RELEASES="" ;;
	# `nie-site` sert le site public. Il etait le SEUL service de facade sans sonde,
	# alors que son propre amont (`nie-model-serve`) en avait une : la panne surveillee
	# etait celle du decodeur, pas celle de la page qui le montre. Seuil recalcule sur
	# son `MemoryMax=10G`.
	nie-site)        PORT=8085; SEUIL_GIB=8.5; SANTE="/healthz"; RELEASES="" ;;
	rg-storage)      PORT=8810; SEUIL_GIB=0.8; SANTE="/health";       RELEASES="" ;;
	rg-cdn)          PORT=8801; SEUIL_GIB=0.8; SANTE="/health"; RELEASES="" ;;
	rg-realtime)     PORT=8812; SEUIL_GIB=0.8; SANTE="/health"; RELEASES="" ;;
	rg-achillea-bot)   PORT=4000; SEUIL_GIB=3.4; SANTE="/health/check"; RELEASES="" ;;
	*) echo "rg-watchdog: service inconnu « $CIBLE » — l'ajouter à la table" >&2; exit 2 ;;
esac

# Une sonde de santé qui met plus que ça à répondre décrit un service figé, pas lent :
# mesuré à chaud, la page d'accueil sort en 0,03 s côté website et 0,8 s côté azalée.
LATENCE_MAX=6
# Part du temps où TOUS les processus du cgroup sont bloqués à attendre de la mémoire
# (`memory.pressure`, ligne `full`, moyenne sur 300 s). Au-delà, le service ne travaille
# plus : il rame. 20 % laisse passer les à-coups d'un build ou d'un pic de trafic.
SEUIL_STALL=20
# Budget anti-boucle : trois redémarrages par demi-heure. Le quatrième ne corrigerait
# rien qu'un humain n'ait à regarder.
BUDGET_REDEMARRAGES=3
FENETRE_BUDGET=1800

SVC="$CIBLE.service"

# Bleu/vert : pendant un déploiement, le trafic passe sur la doublure. Sonder le slot A
# alors que le trafic est sur le slot B redémarrerait en boucle celui qu'on est en train
# de remettre à niveau — d'où la lecture de l'unité et du port réellement servis.
if [ -n "$RELEASES" ]; then
	# shellcheck source=/dev/null
	[ -f "$RELEASES/live.env" ] && . "$RELEASES/live.env"
	SVC="${LIVE_UNIT:-$SVC}"
	PORT="${LIVE_PORT:-$PORT}"
	if [ -e "$RELEASES/deploy.lock" ]; then
		echo "rg-watchdog[$CIBLE]: skip (déploiement en cours)"
		exit 0
	fi
fi

URL="http://127.0.0.1:${PORT}${SANTE}"

etat="$(systemctl show "$SVC" -p ActiveState --value 2>/dev/null)"
sous="$(systemctl show "$SVC" -p SubState --value 2>/dev/null)"
if [ "$sous" = "start" ] || [ "$sous" = "start-pre" ] || [ "$etat" = "activating" ] || [ "$etat" = "deactivating" ]; then
	echo "rg-watchdog[$CIBLE]: skip (redémarrage en cours : $etat/$sous)"
	exit 0
fi

if [ "$etat" != "active" ]; then
	echo "rg-watchdog[$CIBLE]: DÉMARRAGE — $SVC est $etat"
	systemctl start "$SVC"
	exit 0
fi

# ── Sondes HTTP : code ET latence ────────────────────────────────────────────────────
# Une réponse < 500 prouve que le service répond ; elle ne prouve pas qu'il avance. On
# ne sort donc de la boucle par le haut que sur une réponse à la fois valide et rapide.
echecs=0
lenteurs=0
dernier=000
duree=0
for i in 1 2 3; do
	# `curl -w '%{http_code}'` ÉCRIT DÉJÀ « 000 » quand il échoue (délai dépassé,
	# connexion refusée) : le « || echo 000 » historique en ajoutait un SECOND, et la
	# variable valait « 000000 » — qui ne correspond à aucun motif du `case` ci-dessous.
	# Toute panne franche tombait donc dans `*)`, remettait `echecs` à zéro et concluait
	# « OK ». C'est ce qui a laissé nie-model-serve répondre 504 pendant plus d'une heure
	# le 21/8/2026 (19 verdicts « OK (http=000000) ») et website-web 568 fois en 24 h.
	# Le repli ne sert plus qu'au cas où curl n'écrirait rien du tout.
	mesure="$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 12 "$URL" 2>/dev/null)"
	dernier="${mesure%% *}"
	duree="${mesure##* }"
	[ -n "$dernier" ] || dernier=000
	case "$duree" in ''|*[!0-9.]*) duree=0 ;; esac
	case "$dernier" in
		000|502|503|504)
			echecs=$((echecs + 1))
			;;
		*)
			echecs=0
			if awk "BEGIN{exit !($duree > $LATENCE_MAX)}"; then
				lenteurs=$((lenteurs + 1))
			else
				lenteurs=0
				break   # réponse valide ET rapide : le service avance, rien à ajouter
			fi
			;;
	esac
	[ "$i" -lt 3 ] && sleep 5
done

# ── Mémoire du cgroup : occupation, plafonds réels, et pression ──────────────────────
lire_octets() {   # une propriété systemd en octets, 0 si absente ou « infinity »
	local v; v="$(systemctl show "$SVC" -p "$1" --value 2>/dev/null)"
	case "$v" in ''|'[not set]'|infinity|*[!0-9]*) echo 0 ;; *) echo "$v" ;; esac
}
mem="$(lire_octets MemoryCurrent)"
haute="$(lire_octets MemoryHigh)"
maxi="$(lire_octets MemoryMax)"
mem_gib="$(awk "BEGIN{printf \"%.1f\", $mem/1073741824}")"

# Deux falaises, deux sondes. `MemoryMax` est celle où le noyau TUE : c'est elle que
# garde ce seuil absolu, pour reprendre la main proprement avant l'OOM killer.
# `MemoryHigh` est celle où il ÉTRANGLE — et l'étranglement ne se voit pas dans la
# hauteur du RSS (nie-model-serve y vit sans souffrir), seulement dans la pression, d'où
# la sonde PSI plus bas. Confondre les deux, c'était soit rater l'étranglement (le seuil
# d'avant), soit redémarrer toutes les heures un service simplement gros.
# Le seuil de la table ne sert que si l'unité n'impose aucune limite.
if [ "$maxi" -gt 0 ]; then
	SEUIL_GIB="$(awk "BEGIN{printf \"%.2f\", 0.85*$maxi/1073741824}")"
	origine_seuil="85 % de MemoryMax"
elif [ "$haute" -gt 0 ]; then
	SEUIL_GIB="$(awk "BEGIN{printf \"%.2f\", 0.90*$haute/1073741824}")"
	origine_seuil="90 % de MemoryHigh"
else
	origine_seuil="table"
fi

# `memory.pressure` du cgroup de l'unité : ligne `full`, champ avg300. C'est la seule
# mesure qui sépare « gros mais tranquille » de « étranglé ».
stall=0
cg="/sys/fs/cgroup/system.slice/${SVC}/memory.pressure"
if [ -r "$cg" ]; then
	stall="$(awk '/^full/{for(i=2;i<=NF;i++){split($i,kv,"=");if(kv[1]=="avg300")print kv[2]}}' "$cg" 2>/dev/null)"
	case "$stall" in ''|*[!0-9.]*) stall=0 ;; esac
fi

raison=""
[ "$echecs" -ge 3 ] && raison="santé KO 3/3 (dernier=$dernier)"
# La lenteur seule ne suffit pas : un amont poussif (Postgres, CDN) ferait boucler le
# redémarrage sans rien corriger. On n'y voit une panne du service que si sa mémoire le
# corrobore — étranglement mesuré, ou occupation déjà au-dessus de 80 % de la falaise.
if [ "$lenteurs" -ge 3 ]; then
	corrobore=0
	awk "BEGIN{exit !($stall > 5)}" && corrobore=1
	[ "$haute" -gt 0 ] && awk "BEGIN{exit !($mem > 0.80*$haute)}" && corrobore=1
	if [ "$corrobore" -eq 1 ]; then
		raison="${raison:+$raison + }vivant mais figé : ${duree}s > ${LATENCE_MAX}s en 3/3 (stall ${stall} %, ${mem_gib} Gio)"
	else
		echo "rg-watchdog[$CIBLE]: lenteur signalée (${duree}s) mais mémoire saine — amont suspecté, pas de redémarrage"
	fi
fi
if awk "BEGIN{exit !($stall > $SEUIL_STALL)}"; then
	raison="${raison:+$raison + }cgroup étranglé : memory.pressure full avg300=${stall} % > ${SEUIL_STALL} %"
fi
if awk "BEGIN{exit !($mem_gib > $SEUIL_GIB)}"; then
	raison="${raison:+$raison + }mémoire ${mem_gib} Gio > ${SEUIL_GIB} Gio ($origine_seuil, préventif)"
fi

if [ -n "$raison" ]; then
	# Budget anti-boucle : on garde l'horodatage des redémarrages récents dans /run, qui
	# est vidé au reboot. Trois par demi-heure ; au-delà, se taire vaut mieux que
	# redémarrer un service que le redémarrage ne répare pas.
	trace="/run/rg-watchdog-${CIBLE}.redemarrages"
	maintenant="$(date +%s)"
	limite=$((maintenant - FENETRE_BUDGET))
	recents=""
	[ -r "$trace" ] && recents="$(awk -v l="$limite" '$1+0 > l' "$trace" 2>/dev/null)"
	nb="$(printf '%s\n' "$recents" | grep -c '[0-9]')"
	if [ "$nb" -ge "$BUDGET_REDEMARRAGES" ]; then
		echo "rg-watchdog[$CIBLE]: ABANDON — $nb redémarrages en ${FENETRE_BUDGET}s n'ont pas corrigé « $raison » ; intervention humaine requise"
		exit 0
	fi
	echo "rg-watchdog[$CIBLE]: REDÉMARRAGE — $SVC (:$PORT) — $raison"
	{ printf '%s\n' "$recents" | grep '[0-9]'; echo "$maintenant"; } > "$trace" 2>/dev/null
	systemctl restart "$SVC"
else
	echo "rg-watchdog[$CIBLE]: OK ($SVC :$PORT http=$dernier ${duree}s mem=${mem_gib}/${SEUIL_GIB} Gio stall=${stall} %)"
fi
