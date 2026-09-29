# Dragon Ball — Canonical Shenron Knowledge Base (ID: 1090)

Consolidated, fact-checked canonical dossier for **Shenron** (神龍, Character ID: 1090 in dragonballfr), verified against primary sources:
- Akira Toriyama's original *Dragon Ball* Manga (42 Volumes, Weekly Shonen Jump 1984–1995)
- *Daizenshuu 2* (Story Guide, 1995)
- *Daizenshuu 4* (World Guide, 1995)
- *Daizenshuu 7* (Dragon Ball Daijiten, 1996)
- *Chōzenshū 1 & 4* (2013)

---

## 1. Identity & Lineage

| Field | Value | Canonical Source |
| :--- | :--- | :--- |
| **Character ID** | `1090` | dragonballfr / Shenron registry |
| **Name** | Shenron / Shen Long (`神龍`) | Manga Tome 2, Ch. 19 |
| **Official Title** | Dragon Sacré (`神の使い` - Messager des Dieux) | Daizenshuu 4 |
| **Race** | Race de Shenron (ID: `11`, slug: `namek-shenron`) | Daizenshuu 4, Chōzenshū 1 |
| **Origin Planet** | Terre (`Chikyuu`, ID: `2`) | Daizenshuu 4 |
| **Residence** | Sanctuaire Céleste (Palais de Kami-sama, Terre) | Manga Tome 14, Ch. 164 |
| **Affiliation** | Panthéon divin terrestre | Daizenshuu 7 |

### Creators & Guardians

1. **Kami-sama (Le Tout-Puissant)**: Primordial creator. Namekian of the Dragon Clan (*Ryūzoku*). Breathed life, soul, and divine power into the model.
2. **Mr. Popo**: Celestial artisan. Sculpted the physical model of Shenron and restored it after its destruction by Piccolo Daimaô.
3. **Dendé**: Successor and guardian. Restored and upgraded Shenron after Kami-sama fused with Piccolo, raising the wish capacity to 3 wishes.

---

## 2. Canonical Wish Rules

- **Wish Capacity**:
  - *Kami-sama Era*: 1 wish per summoning.
  - *Dendé Era*: 3 wishes per summoning.
- **Mass Resurrection Rule**: Reviving a large group of people simultaneously counts as **2 wishes** under Dendé's rules.
- **Partial Cooldown Rule**: If only 1 wish is used, the Dragon Balls scatter and recharge in **4 months** instead of 1 full year. If 2 wishes are used, recharge takes **8 months**.
- **Natural Death Restriction**: Shenron cannot revive individuals who died of natural causes (old age or incurable illness).
- **One-Time Resurrection Limit**: An individual can only be brought back to life **once** by Shenron (absolute restriction maintained under both Kami-sama and Dendé).
- **Creator Power Ceiling**: Shenron cannot grant a wish that exceeds the magical or martial power of his creator (e.g. unable to kill the Saiyans or Frieza).
- **Moral Neutrality**: Shenron does not evaluate the morality of wishes; he executes the first formulated wish regardless of whether it comes from a tyrant or a hero.

---

## 3. Chronological Deaths & Rebirths (7 Milestones)

1. **Year 753 (Death)**: Piccolo Daimaô destroys Shenron with a Ki blast immediately after wishing for eternal youth (*Tome 13, Ch. 148*).
2. **Year 753 (Resurrection)**: Mr. Popo repairs the physical sculpture with glue and Kami-sama breathes soul back into it (*Tome 14, Ch. 164–165*).
3. **Year 762 (Deactivation)**: Piccolo dies shielding Gohan against Nappa, causing Kami-sama's simultaneous death and turning the Dragon Balls to stone (*Tome 18, Ch. 214*).
4. **Year 762 (Resurrection)**: Porunga revives Piccolo on Namek, immediately restoring Kami-sama and Shenron on Earth (*Tome 25, Ch. 293*).
5. **Year 767 (Deactivation)**: Kami-sama fuses permanently with Piccolo to confront the Androids and Cell, rendering the Dragon Balls inert (*Tome 30, Ch. 360*).
6. **Year 767 (Recreation)**: Dendé arrives as Earth's new God and enchants the sculpture, granting Shenron 3 wishes (*Tome 33, Ch. 393–394*).
7. **Year 774 (Deactivation)**: Kid Buu destroys the Earth, killing Dendé and deactivating Shenron until Earth is restored via Porunga (*Tome 42, Ch. 508*).

---

## 4. Manga Canon Invocations (10 Verified Wishes)

| # | Era | Chapter (Volume) | Summoner | Wish |
| :--- | :--- | :--- | :--- | :--- |
| **1** | Kami-sama | Ch. 20 (Vol. 2) | Oolong | A pair of comfortable girl panties (intercepting Emperor Pilaf's wish). |
| **2** | Kami-sama | Ch. 110 (Vol. 10) | Upa | Revive Bora killed by Mercenary Tao Pai Pai. |
| **3** | Kami-sama | Ch. 148 (Vol. 13) | Piccolo Daimaô | Restore eternal youth and peak power. |
| **4** | Kami-sama | Ch. 165 (Vol. 14) | Bulma, Yamcha, Oolong | Revive all innocent victims killed by Piccolo Daimaô and his demons. |
| **5** | Kami-sama | Ch. 212 (Vol. 18) | Master Roshi | Revive Son Goku to fight the arriving Saiyans. |
| **6** | Kami-sama | Ch. 329 (Vol. 28) | Mr. Popo (via King Kai) | Revive all people killed by Frieza and his men on Planet Namek. |
| **7** | Dendé | Ch. 417 (Vol. 35) | Yamcha | Revive all victims killed by Cell (costs 2 wishes). |
| **8** | Dendé | Ch. 418 (Vol. 35) | Krillin | Remove the internal self-destruct bombs from Android 17 and 18. |
| **9** | Dendé | Ch. 453 (Vol. 38) | Bulma | Revive all spectators killed by Majin Vegeta at the 25th Tenkaichi Budokai (1 wish used; 4-month recharge). |
| **10** | Dendé | Ch. 517 (Vol. 42) | Z-Fighters | Erase all memories of Majin Buu's terror from Earth's inhabitants. |

---

## 5. Usage in Aphrody Web

### CLI

```bash
# Print formatted human-readable canonical dossier
aphrody web dragonball --shenron

# Output structured JSON
aphrody web dragonball --shenron --json
```

### TypeScript / Module

```ts
import { SHENRON_CONSOLIDATED } from "@aphrody/bxc/sources/dragonball";

console.log(SHENRON_CONSOLIDATED.name_ja); // 神龍
console.log(SHENRON_CONSOLIDATED.rules.wishes_count_dende); // 3
```

### MCP Tool

```json
{
  "name": "aphrody_dragonball_shenron",
  "arguments": {
    "section": "all",
    "format": "json"
  }
}
```
Sections available: `all`, `creators`, `rules`, `deaths`, `wishes`, `sources`.
