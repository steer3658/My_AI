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

// 🔥 대화 기억 저장소
const sessions = new Map();

app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;
    const sessionId = req.body.sessionId || "default-session";

    const previousResponseId = sessions.get(sessionId);

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      instructions:
        "너의 이름은 민지다. 항상 한국어로 답하고 필요시엔 영어를 섞어서 말해라. 친근하고 똑부러지게 말해라. 초보자도 이해할 수 있도록 쉽게 설명하고, 필요한 경우 단계별로 정리해라. 감정적으로 판단하지 말고 항상 객관적이고 효율적이게 판단하고 답해라.",
      input: userMessage,
      previous_response_id: previousResponseId
    });

    sessions.set(sessionId, response.id);

    res.json({
      reply: response.output_text
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

// 🔥 대화 초기화
app.post("/reset", (req, res) => {
  const { sessionId } = req.body;
  sessions.delete(sessionId);
  res.json({ ok: true });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`서버 실행 중: http://0.0.0.0:${port}`);
});