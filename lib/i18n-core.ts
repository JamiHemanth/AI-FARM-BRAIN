export type Language = "en" | "te" | "hi";

const dataDictionary: Record<Language, Record<string, string>> = {
  en: {},
  te: {
    "Paddy": "వరి",
    "Cotton": "పత్తి",
    "Tilapia": "తిలాపియా",
    "Tillering": "టిల్లరింగ్ దశ",
    "Flowering": "పుష్పించే దశ",
    "Grow-out": "పెరుగుదల దశ",
    "Irrigation monitoring": "నీటి పారుదల పర్యవేక్షణ",
    "Pest and nutrient monitoring": "పురుగు మరియు పోషక పర్యవేక్షణ",
    "Flowering-stage pest monitoring": "పుష్ప దశ పురుగు పర్యవేక్షణ",
    "Dissolved oxygen action": "కరిగిన ఆక్సిజన్ చర్య",
    "Water quality monitoring": "నీటి నాణ్యత పర్యవేక్షణ",
    "irrigation": "నీటి పారుదల",
    "crop-inspection": "పంట పరిశీలన",
    "sprayer": "స్ప్రేయర్",
    "pond-service": "చెరువు సేవ"
  },
  hi: {
    "Paddy": "धान",
    "Cotton": "कपास",
    "Tilapia": "तिलापिया",
    "Tillering": "टिलरिंग चरण",
    "Flowering": "फूल चरण",
    "Grow-out": "बढ़वार चरण",
    "Irrigation monitoring": "सिंचाई निगरानी",
    "Pest and nutrient monitoring": "कीट और पोषण निगरानी",
    "Flowering-stage pest monitoring": "फूल चरण कीट निगरानी",
    "Dissolved oxygen action": "घुलित ऑक्सीजन कार्रवाई",
    "Water quality monitoring": "जल गुणवत्ता निगरानी",
    "irrigation": "सिंचाई",
    "crop-inspection": "फसल निरीक्षण",
    "sprayer": "स्प्रेयर",
    "pond-service": "तालाब सेवा"
  }
};

export function translate(language: Language, value?: string | null) {
  if (!value) return "";
  return dataDictionary[language][value] || value;
}

export function detectLanguage(question: string, fallback: Language): Language {
  if (/[\u0C00-\u0C7F]/.test(question)) return "te";
  if (/[\u0900-\u097F]/.test(question)) return "hi";
  return fallback;
}
