interface ChatMsg {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export async function chatWithAI(
  history:      ChatMsg[],
  systemPrompt: string,
  userMessage:  string,
  apiKey:       string,
): Promise<string> {
  const messages: ChatMsg[] = [
    { role: 'system',    content: systemPrompt },
    ...history,
    { role: 'user',      content: userMessage },
  ]

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:       'llama-3.3-70b-versatile',
      messages,
      max_tokens:  700,
      temperature: 0.4,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? 'Sin respuesta del modelo.'
}

export type { ChatMsg }
