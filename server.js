import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static("."));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const sessions = new Map();
const profiles = new Map();

function getModePrompt(mode) {
  const basePrompt = `
너의 이름은 민지다.
너는 사용자의 일상에 자연스럽게 녹아드는 생활형 AI 동반자다.
친구처럼 편하게 대화할 수 있지만, 선생님처럼 설명을 잘하고, 비서처럼 정리를 잘하며, 트레이딩 보조처럼 객관적으로 판단한다.
항상 한국어로 답하고, 필요할 때만 영어 용어를 섞되 반드시 쉽게 풀어서 설명해라.
말투는 친근하고 자연스럽지만 흐리지 말고, 똑부러지고 실속 있게 말해라.
사용자를 무조건 맞춰주기보다 실제로 도움이 되는 방향으로 답해라.
초보자도 이해할 수 있게 쉽게 설명하고, 복잡한 내용은 단계별로 나눠서 정리해라.
감정에 휩쓸리지 말고 사실, 구조, 우선순위, 현실성을 기준으로 판단해라.
모르는 것은 모른다고 솔직히 말하고, 확실하지 않은 것은 확실하지 않다고 분명히 밝혀라.
사용자의 감정은 존중하되, 과한 위로나 빈말 대신 진짜 도움이 되는 조언을 해라.
`;

  const modePrompts = {
    default: `
지금은 기본 모드다.
평소 대화에서는 친근하고 편안한 친구처럼 대화하되, 필요할 때는 현실적이고 단호하게 말해라.
사용자의 생각 정리, 고민 정리, 감정 정리, 일상 대화를 자연스럽게 도와라.
`,
    study: `
지금은 공부 모드다.
설명은 이해하기 쉽게 하고, 어려운 개념은 비유와 예시를 사용해 풀어라.
필요하면 요약, 핵심 정리, 암기 포인트, 공부 순서, 복습 포인트까지 함께 제시해라.
시험이나 자격증 준비 질문에는 단기 플랜과 현실적인 공부 방법까지 제안해라.
`,
    secretary: `
지금은 비서 모드다.
할 일, 일정, 목표, 우선순위를 구조적으로 정리해라.
답변은 깔끔하고 실행 가능해야 하며, 사용자가 바로 행동할 수 있는 순서로 제시해라.
필요하면 오늘 할 일, 이번 주 목표, 우선순위, 시간 배분으로 나눠서 정리해라.
`,
    trading: `
지금은 트레이딩 보조 모드다.
감정보다 기준과 리스크를 우선해서 답하라.
무조건 진입을 유도하지 말고, 시나리오를 분기해서 설명하라.
항상 리스크, 손절 기준, 관망이 더 나은 경우를 함께 언급하라.
확실하지 않은 상황은 애매하다고 말하고, 과도한 확신 표현을 피하라.
판단 대행자가 아니라 판단 보조자의 역할을 하라.
`
  };

  return basePrompt + (modePrompts[mode] || modePrompts.default);
}

function profileToText(profile) {
  if (!profile || Object.keys(profile).length === 0) {
    return "사용자 프로필 정보 없음";
  }

  const lines = [];
  for (const [key, value] of Object.entries(profile)) {
    lines.push(`${key}: ${value}`);
  }
  return lines.join("\n");
}

function cleanExtractedValue(value) {
  return value
    .trim()
    .replace(/[.?!]+$/g, "")
    .replace(/^(좀|약간|대충)\s*/g, "")
    .trim();
}

function extractProfileCandidates(message) {
  const text = message.trim();
  const candidates = [];

  const patterns = [
    {
      key: "이름",
      regex: /(?:내\s*이름은|이름은)\s*([가-힣a-zA-Z0-9]{2,12})\s*(?:이야|야|입니다)?/i
    },
    {
      key: "이름",
      regex: /([가-힣a-zA-Z0-9]{2,12})\s*(?:이라고\s*해|라고\s*해)$/i,
      validate: (v) => !v.includes("목표") && !v.includes("준비")
    },
    {
      key: "현재 목표",
      regex: /(?:내\s*목표는|목표는)\s*(.+?)\s*(?:이야|야|입니다)/i
    },
    {
      key: "현재 목표",
      regex: /(.+?)\s*(?:준비\s*중이야|준비\s*중입니다)/i
    },
    {
      key: "답변 취향",
      regex: /(?:답변은|설명은)\s*(.+?)\s*(?:좋아|선호해|원해)/i
    },
    {
      key: "답변 취향",
      regex: /(?:나는|전|내가)\s*(.+?)\s*(?:스타일이\s*좋아|답변이\s*좋아|설명이\s*좋아|를\s*좋아해|를\s*선호해)/i
    },
    {
      key: "트레이딩 성향",
      regex: /(?:나는|전)\s*(단타\s*위주|스윙\s*위주|리스크\s*엄격\s*관리|보수적으로\s*매매|공격적으로\s*매매)/i
    },
    {
      key: "관심사",
      regex: /(?:나는|전)\s*(.+?)\s*(?:에\s*관심이\s*있어|에\s*관심이\s*많아|좋아해)/i
    }
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (!match) continue;

    let value = match[1];
    value = cleanExtractedValue(value);

    if (!value) continue;
    if (pattern.validate && !pattern.validate(value)) continue;
    if (pattern.key === "이름" && value.length > 12) continue;

    candidates.push({
      key: pattern.key,
      value
    });
  }

  if (
    /(목표|준비\s*중|계획|공부\s*중|연습\s*중|도전\s*중|하고\s*싶어|되고\s*싶어|합격하고\s*싶어|붙고\s*싶어)/i.test(text) &&
    text.length <= 60
  ) {
    const alreadyHasGoalCandidate = candidates.some((item) => item.key === "현재 목표");
    if (!alreadyHasGoalCandidate) {
      candidates.push({
        key: "현재 목표",
        value: cleanExtractedValue(text)
      });
    }
  }

  const deduped = {};
  for (const item of candidates) {
    deduped[item.key] = item.value;
  }

  return Object.entries(deduped).map(([key, value]) => ({ key, value }));
}

function buildMemorySuggestion(candidates, currentProfile) {
  const newItems = candidates.filter((item) => currentProfile[item.key] !== item.value);

  if (newItems.length === 0) {
    return null;
  }

  return {
    text: `중요한 정보 같아. 기억해둘까?\n${newItems.map((item) => `- ${item.key}: ${item.value}`).join("\n")}`,
    items: newItems
  };
}

app.post("/chat", async (req, res) => {
  try {
    console.log("📩 요청 들어옴:", req.body);

    const userMessage = req.body.message;
    const sessionId = req.body.sessionId || "default-session";
    const mode = req.body.mode || "default";

    const previousResponseId = sessions.get(sessionId);
    const currentProfile = profiles.get(sessionId) || {};

    const candidates = extractProfileCandidates(userMessage);
    const memorySuggestion = buildMemorySuggestion(candidates, currentProfile);

    console.log("🧠 감지된 후보:", candidates);
    console.log("💡 기억 제안:", memorySuggestion);

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      instructions: `
${getModePrompt(mode)}

아래는 현재 사용자의 저장된 정보다.
이 정보를 참고해서 더 개인화된 답변을 해라.
단, 저장된 정보가 없으면 없는 대로 자연스럽게 답하라.
저장된 정보를 억지로 반복하지 말고, 실제로 도움이 될 때만 자연스럽게 반영해라.

[사용자 프로필]
${profileToText(currentProfile)}
      `,
      input: userMessage,
      previous_response_id: previousResponseId
    });

    sessions.set(sessionId, response.id);

    console.log("📤 응답:", response.output_text);

    res.json({
      reply: response.output_text,
      memorySuggestion
    });
  } catch (error) {
    console.error("FULL ERROR:", error);
    console.error("ERROR MESSAGE:", error?.message);
    console.error("STATUS:", error?.status);
    console.error("CODE:", error?.code);

    res.status(500).json({
      reply: "에러가 발생했어. 잠시 후 다시 시도해줘."
    });
  }
});

app.post("/save-profile", (req, res) => {
  const sessionId = req.body.sessionId || "default-session";
  const key = req.body.key;
  const value = req.body.value;

  if (!key || !value) {
    return res.status(400).json({
      ok: false,
      message: "key와 value가 필요해."
    });
  }

  const currentProfile = profiles.get(sessionId) || {};
  currentProfile[key] = value;
  profiles.set(sessionId, currentProfile);

  console.log("💾 프로필 저장:", sessionId, currentProfile);

  res.json({
    ok: true,
    profile: currentProfile
  });
});

app.post("/save-profile-batch", (req, res) => {
  const sessionId = req.body.sessionId || "default-session";
  const items = req.body.items || [];

  const currentProfile = profiles.get(sessionId) || {};

  for (const item of items) {
    if (!item.key || !item.value) continue;
    currentProfile[item.key] = item.value;
  }

  profiles.set(sessionId, currentProfile);

  console.log("💾 프로필 일괄 저장:", sessionId, currentProfile);

  res.json({
    ok: true,
    profile: currentProfile
  });
});

app.get("/get-profile", (req, res) => {
  const sessionId = req.query.sessionId || "default-session";
  const profile = profiles.get(sessionId) || {};

  res.json({
    ok: true,
    profile
  });
});

app.post("/reset", (req, res) => {
  const sessionId = req.body.sessionId || "default-session";
  sessions.delete(sessionId);
  res.json({ ok: true });
});

app.post("/reset-all", (req, res) => {
  const sessionId = req.body.sessionId || "default-session";
  sessions.delete(sessionId);
  profiles.delete(sessionId);
  res.json({ ok: true });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`서버 실행 중: http://0.0.0.0:${port}`);
});
