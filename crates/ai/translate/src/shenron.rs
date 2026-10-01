// SPDX-License-Identifier: Apache-2.0
//! Shenron — Protection du domaine japonais et contrôle qualité de traduction JP -> FR.
//!
//! Porte les règles de souveraineté linguistique de Shenron (`dragonballfr.com` /
//! `apps/site/src/lib/ja/traduction.ts`) :
//!   1. `intraduisible`       -> Détection précoce des artefacts corrompus (chinois simplifié,
//!      latin collé, boucle)
//!   2. `segments_traduisibles` -> Découpage déterministe aux frontières naturelles de phrase
//!      japonaise
//!   3. `proteger_termes`     -> Masquage des termes canoniques par des jetons latins neutres
//!      (Zeta, Yuni, Kilo...)
//!   4. `restaurer_termes`    -> Réinjection chirurgicale de la graphie officielle française
//!   5. `refus`               -> Contrôle de cohérence de sortie (ratio de japonais résiduel,
//!      complétude)
//!   6. `default_canon_lexique` -> Référentiel canonique unifié Dragon Ball + Inazuma Eleven /
//!      Aphrodi

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Un terme du lexique canonique.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TermeLexique {
    /// Graphie japonaise exacte (ex: "界王拳", "ベジータ", "神龍", "ヘブンズタイム")
    pub ja: String,
    /// Forme française officielle (ex: "Kaïō-ken", "Vegeta", "Shenron", "Temps Céleste")
    pub fr: String,
    /// Catégorie : "personnage", "technique", "lieu", "objet", "concept"
    pub kind: String,
}

impl TermeLexique {
    pub fn new(ja: impl Into<String>, fr: impl Into<String>, kind: impl Into<String>) -> Self {
        Self { ja: ja.into(), fr: fr.into(), kind: kind.into() }
    }
}

/// Jetons de substitution latins neutres.
/// Traversent les modèles de traduction (NLLB, Google Translate, etc.) intacts
/// sans être translittérés ou traduits de manière erronée.
pub const JETONS: [&str; 16] = [
    "Zeta", "Yuni", "Kilo", "Nova", "Orga", "Vira", "Puma", "Rexo", "Talo", "Miro", "Sano", "Delo",
    "Faro", "Gemo", "Hino", "Juno",
];

/// Résultat du masquage des termes du domaine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TexteProtege {
    /// Texte à soumettre au moteur de traduction avec jetons substitués.
    pub masque: String,
    /// Table de correspondance Jeton -> Forme française officielle.
    pub table: HashMap<String, String>,
    /// Nombre de termes détectés n'ayant pas pu être protégés faute de jetons libres.
    pub debordement: usize,
}

/// Masque les termes du lexique présents dans le texte japonais.
/// Les termes sont triés par longueur décroissante pour éviter qu'un préfixe ne masque
/// un mot composé (ex: "サイヤ" ne doit pas casser "サイヤ人").
pub fn proteger_termes(texte: &str, lexique: &[TermeLexique]) -> TexteProtege {
    let mut lex_trie = lexique.to_vec();
    lex_trie.sort_by_key(|term| std::cmp::Reverse(term.ja.len()));

    let mut table = HashMap::new();
    let mut masque = texte.to_string();
    let mut jeton_idx = 0;
    let mut debordement = 0;

    for t in lex_trie {
        if t.fr.is_empty() || !masque.contains(&t.ja) {
            continue;
        }
        if jeton_idx >= JETONS.len() {
            debordement += 1;
            continue;
        }
        let jeton = JETONS[jeton_idx];
        jeton_idx += 1;
        table.insert(jeton.to_string(), t.fr.clone());
        masque = masque.replace(&t.ja, jeton);
    }

    TexteProtege { masque, table, debordement }
}

/// Réinjecte les formes françaises officielles à la place des jetons.
/// Les jetons sont substitués par longueur décroissante pour garantir l'intégrité.
pub fn restaurer_termes(traduction: &str, table: &HashMap<String, String>) -> String {
    let mut out = traduction.to_string();
    let mut jetons: Vec<_> = table.keys().collect();
    jetons.sort_by_key(|jeton| std::cmp::Reverse(jeton.len()));

    for jeton in jetons {
        if let Some(fr) = table.get(jeton) {
            out = out.replace(jeton, fr);
        }
    }
    out
}

/// Découpe un texte japonais en segments traduisibles sûrs.
/// Coupure aux fins de phrase japonaises (。、！、？) ou sauts de ligne, sans dépasser
/// `max_signes`.
pub fn segments_traduisibles(texte: &str, max_signes: usize) -> Vec<String> {
    let mut segments = Vec::new();
    let mut courant = String::new();

    // Découpage par caractères en conservant les délimiteurs
    let mut buffer = String::new();
    for ch in texte.chars() {
        buffer.push(ch);
        if ch == '。' || ch == '！' || ch == '？' || ch == '!' || ch == '?' || ch == '\n' {
            if courant.chars().count() + buffer.chars().count() > max_signes
                && !courant.trim().is_empty()
            {
                segments.push(courant.trim().to_string());
                courant.clear();
            }
            courant.push_str(&buffer);
            buffer.clear();
        }
    }
    if !buffer.is_empty() {
        if courant.chars().count() + buffer.chars().count() > max_signes
            && !courant.trim().is_empty()
        {
            segments.push(courant.trim().to_string());
            courant.clear();
        }
        courant.push_str(&buffer);
    }

    if !courant.trim().is_empty() {
        segments.push(courant.trim().to_string());
    }

    if segments.is_empty() && !texte.trim().is_empty() {
        segments.push(texte.trim().to_string());
    }

    segments
}

/// Signatures d'échec rendant une transcription japonaise intraduisible.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Intraduisible {
    /// Présence de sinogrammes simplifiés chinois absents du japonais.
    ChinoisSimplifie,
    /// Bruit latin collé en plein mot japonais (OCR défectueux).
    LatinColle,
    /// Répétition disperse du même bloc sans justification.
    BoucleDispersee,
}

impl std::fmt::Display for Intraduisible {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ChinoisSimplifie => write!(f, "chinois-simplifie"),
            Self::LatinColle => write!(f, "latin-colle"),
            Self::BoucleDispersee => write!(f, "boucle-dispersee"),
        }
    }
}

/// Vérifie si une transcription japonaise est traduisible selon les règles Shenron.
pub fn intraduisible(texte: &str) -> Option<Intraduisible> {
    // 1. Sinogrammes simplifiés chinois
    const SIMPLIFIES: [char; 24] = [
        '个', '陆', '这', '说', '见', '门', '东', '车', '马', '鸟', '贝', '长', '风', '飞', '龙',
        '业', '习', '乡', '书', '买', '卖', '画', '发', '产',
    ];
    if texte.chars().any(|c| SIMPLIFIES.contains(&c)) {
        return Some(Intraduisible::ChinoisSimplifie);
    }

    // 2. Latin collé (minuscules greffées au japonais)
    if detect_latin_colle(texte) {
        return Some(Intraduisible::LatinColle);
    }

    // 3. Boucle dispersée
    if boucle_dispersee(texte) {
        return Some(Intraduisible::BoucleDispersee);
    }

    None
}

fn is_japanese_char(c: char) -> bool {
    matches!(c,
        '\u{3040}'..='\u{309F}' | // Hiragana
        '\u{30A0}'..='\u{30FF}' | // Katakana
        '\u{4E00}'..='\u{9FAF}'   // CJK Unified Ideographs
    )
}

fn detect_latin_colle(texte: &str) -> bool {
    let chars: Vec<char> = texte.chars().collect();
    let len = chars.len();
    if len < 4 {
        return false;
    }

    for i in 0..len {
        if is_japanese_char(chars[i]) {
            // Séquence de 3+ lettres minuscules après japonais
            if i + 3 < len
                && chars[i + 1].is_ascii_lowercase()
                && chars[i + 2].is_ascii_lowercase()
                && chars[i + 3].is_ascii_lowercase()
            {
                // Vérifie que ce n'est pas un mot capitalisé légitime (ex: WJNo)
                if i == 0 || !chars[i - 1].is_ascii_uppercase() {
                    return true;
                }
            }
        }
    }
    false
}

fn boucle_dispersee(texte: &str) -> bool {
    let chars: Vec<char> = texte.chars().collect();
    if chars.len() < 45 {
        return false;
    }

    for i in (0..chars.len().saturating_sub(30)).step_by(15) {
        let block: String = chars[i..i + 30].iter().collect();
        if !block.chars().any(is_japanese_char) {
            continue;
        }

        // `i` above is a character index, while `str::find` and slicing use
        // byte offsets. Keep `pos` on a UTF-8 boundary and advance by the
        // matched block's byte length; adding the 30-character length here
        // used to panic on Japanese text whose characters occupy 3 bytes.
        let mut count = 0;
        let mut pos = 0;
        while let Some(idx) = texte[pos..].find(&block) {
            count += 1;
            pos += idx + block.len();
            if pos >= texte.len() {
                break;
            }
        }
        if count >= 3 {
            return true;
        }
    }
    false
}

/// Proportion de caractères japonais dans un texte (0.0 à 1.0).
pub fn proportion_japonais(texte: &str) -> f64 {
    let non_blancs: Vec<char> = texte.chars().filter(|c| !c.is_whitespace()).collect();
    if non_blancs.is_empty() {
        return 0.0;
    }
    let ja_count = non_blancs.iter().filter(|&&c| is_japanese_char(c)).count();
    ja_count as f64 / non_blancs.len() as f64
}

/// Seuil maximum de caractères japonais tolérés dans une traduction française (15%).
pub const PART_JA_MAX: f64 = 0.15;

/// Vérifie la validité d'une traduction FR issue d'une source japonaise.
pub fn refus(fr: &str, _ja: &str) -> Option<String> {
    let texte = fr.trim();
    if texte.is_empty() {
        return Some("traduction vide".to_string());
    }
    let part = proportion_japonais(texte);
    if part > PART_JA_MAX {
        return Some(format!(
            "{:.1}% de japonais résiduel non traduit (seuil: {:.0}%)",
            part * 100.0,
            PART_JA_MAX * 100.0
        ));
    }
    None
}

/// Lexique canonique par défaut fusionnant l'Axe 2 (Dragon Ball / Shenron)
/// et l'Axe 1 (Inazuma Eleven / Niers / Aphrodi).
pub fn default_canon_lexique() -> Vec<TermeLexique> {
    vec![
        // --- Dragon Ball (Axe 2 / Shenron) ---
        TermeLexique::new("孫悟空", "Son Goku", "personnage"),
        TermeLexique::new("悟空", "Goku", "personnage"),
        TermeLexique::new("カカロット", "Kakarotto", "personnage"),
        TermeLexique::new("ベジータ", "Vegeta", "personnage"),
        TermeLexique::new("サイヤ人", "Saiyan", "concept"),
        TermeLexique::new("超サイヤ人", "Super Saiyan", "concept"),
        TermeLexique::new("超サイヤ人ゴッド", "Super Saiyan God", "concept"),
        TermeLexique::new("界王拳", "Kaïō-ken", "technique"),
        TermeLexique::new("かめはめ波", "Kaméhaméha", "technique"),
        TermeLexique::new("元気玉", "Genki Dama", "technique"),
        TermeLexique::new("気円斬", "Kienzan", "technique"),
        TermeLexique::new("魔貫光殺砲", "Makankosappo", "technique"),
        TermeLexique::new("ピッコロ", "Piccolo", "personnage"),
        TermeLexique::new("クリリン", "Krilin", "personnage"),
        TermeLexique::new("ヤムチャ", "Yamcha", "personnage"),
        TermeLexique::new("天津飯", "Tenshinhan", "personnage"),
        TermeLexique::new("餃子", "Chaozu", "personnage"),
        TermeLexique::new("亀仙人", "Tortue Géniale (Kame Sennin)", "personnage"),
        TermeLexique::new("フリーザ", "Freezer", "personnage"),
        TermeLexique::new("セル", "Cell", "personnage"),
        TermeLexique::new("魔人ブウ", "Majin Boo", "personnage"),
        TermeLexique::new("神龍", "Shenron", "personnage"),
        TermeLexique::new("大界王", "Grand Kaïō", "personnage"),
        TermeLexique::new("破壊神ビルス", "Beerus le destructeur", "personnage"),
        TermeLexique::new("ウイス", "Whis", "personnage"),
        TermeLexique::new("ドラゴンボール", "Dragon Ball", "concept"),
        // --- Inazuma Eleven / Level-5 / Niers (Axe 1 / Aphrodi) ---
        TermeLexique::new("亜風炉 照美", "Aphrodi (Byron Love)", "personnage"),
        TermeLexique::new("亜風炉照美", "Aphrodi (Byron Love)", "personnage"),
        TermeLexique::new("アフロディ", "Aphrodi", "personnage"),
        TermeLexique::new("世宇子", "Zeus", "lieu"),
        TermeLexique::new("世宇子中", "Collège Zeus", "lieu"),
        TermeLexique::new("雷門", "Raimon", "lieu"),
        TermeLexique::new("雷門中", "Collège Raimon", "lieu"),
        TermeLexique::new("帝国学園", "Royal Academy", "lieu"),
        TermeLexique::new("円堂 守", "Mark Evans (Mamoru Endo)", "personnage"),
        TermeLexique::new("円堂守", "Mark Evans", "personnage"),
        TermeLexique::new("豪炎寺 修也", "Axel Blaze (Shuya Goenji)", "personnage"),
        TermeLexique::new("豪炎寺修也", "Axel Blaze", "personnage"),
        TermeLexique::new("鬼道 有人", "Jude Sharp (Yuto Kido)", "personnage"),
        TermeLexique::new("鬼道有人", "Jude Sharp", "personnage"),
        TermeLexique::new("ゴッドノウズ", "Tir Divin (God Knows)", "technique"),
        TermeLexique::new("ヘブンズタイム", "Temps Céleste (Heaven's Time)", "technique"),
        TermeLexique::new("カオスブレイク", "Tir Chaotique (Chaos Break)", "technique"),
        TermeLexique::new("ゴッドブレイク", "Savoir Divin (God Break)", "technique"),
        TermeLexique::new("ゴッドハンド", "Main Céleste (God Hand)", "technique"),
        TermeLexique::new("マジン・ザ・ハンド", "Main Magique (Majin The Hand)", "technique"),
        TermeLexique::new("ファイアトルネード", "Tornade de Feu (Fire Tornado)", "technique"),
        TermeLexique::new("イナズマイレブン", "Inazuma Eleven", "concept"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_protection_and_restoration() {
        let lexique = default_canon_lexique();
        let texte = "孫悟空は界王拳を使ってベジータと戦った。";
        let prot = proteger_termes(texte, &lexique);

        assert!(
            prot.masque.contains("Zeta")
                || prot.masque.contains("Yuni")
                || prot.masque.contains("Kilo")
        );
        assert!(!prot.masque.contains("孫悟空"));
        assert!(!prot.masque.contains("界王拳"));
        assert!(!prot.masque.contains("ベジータ"));

        let fake_translated = prot
            .masque
            .replace("を使って", " a utilisé ")
            .replace("と戦った。", " pour combattre ");

        let restored = restaurer_termes(&fake_translated, &prot.table);
        assert!(restored.contains("Son Goku"));
        assert!(restored.contains("Kaïō-ken"));
        assert!(restored.contains("Vegeta"));
    }

    #[test]
    fn test_segments_traduisibles() {
        let texte = "第一の文です。第二の文です！第三の文ですか？\n第四の文です。";
        let segs = segments_traduisibles(texte, 30);
        assert!(!segs.is_empty());
        for s in &segs {
            assert!(s.chars().count() <= 35);
        }
    }

    #[test]
    fn test_intraduisible_simplified_chinese() {
        let chinese = "这是简化字测试";
        assert_eq!(intraduisible(chinese), Some(Intraduisible::ChinoisSimplifie));

        let pure_japanese = "これは日本語の正しい文章です。";
        assert_eq!(intraduisible(pure_japanese), None);
    }

    #[test]
    fn test_refus_residual_japanese() {
        let fr_clean = "Son Goku a utilisé le Kaïō-ken.";
        assert_eq!(refus(fr_clean, "孫悟空は界王拳を使った"), None);

        let fr_dirty = "Son Goku a utilisé 界王拳 pour 攻撃.";
        assert!(refus(fr_dirty, "孫悟空は界王拳を使った").is_some());
    }

    #[test]
    fn test_boucle_dispersee_respects_utf8_boundaries() {
        let texte = "界王拳".repeat(60);
        assert!(boucle_dispersee(&texte));
    }
}
