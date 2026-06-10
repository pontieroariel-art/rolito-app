interface GeminiMsg {
  role: 'user' | 'model'
  parts: [{ text: string }]
}

export async function chatWithGemini(
  history:      GeminiMsg[],
  systemPrompt: string,
  userMessage:  string,
  apiKey:       string,
): Promise<string> {
  const contents: GeminiMsg[] = [
    ...history,
    { role: 'user', parts: [{ text: userMessage }] },
  ]

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 700, temperature: 0.4 },
      }),
    },
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`)
  }

  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'Sin respuesta del modelo.'
}

export type { GeminiMsg }
