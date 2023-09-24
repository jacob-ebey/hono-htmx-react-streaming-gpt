import * as Bun from 'bun'
import { Database } from 'bun:sqlite'
import { Context, Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import * as React from 'react'
import { renderToReadableStream } from 'react-dom/server'
import OpenAI from 'openai'

import {
	ChatMessage,
	ChatView,
	Document,
	PendingChatMessage,
} from './components.js'

if (Bun.env.DEV) {
	Bun.spawn(['bun', 'build:styles'])
}

const openai = new OpenAI()

const db = new Database('./chat.db', { create: true })
const app = new Hono()

db.query(`
  CREATE TABLE IF NOT EXISTS chat (
    id INTEGER PRIMARY KEY AUTOINCREMENT
  );
`).run()
db.query(`
  CREATE TABLE IF NOT EXISTS message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chatId INTEGER NOT NULL,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    FOREIGN KEY (chatId) REFERENCES chat(id)
  );
`).run()

const initialMessage =
	"Welcome! I'm here to help you with your Web Programming related tasks, what can I assist with?"

function sendMessage(
	input: FormData | { chatId: string; text: string },
	messages: { author: string; text: string }[],
) {
	const chatId = Number.parseInt(
		input instanceof FormData ? String(input.get('chatId')) : input.chatId,
	)

	const text = input instanceof FormData ? input.get('text') : input.text

	if (!Number.isSafeInteger(chatId) || typeof text !== 'string' || !text) {
		return {
			error: <p className="text-red-500">Invalid message.</p>,
		}
	}

	try {
		db.prepare(
			'INSERT INTO message (chatId, author, text) VALUES (?, ?, ?)',
		).run(chatId, 'Me', text)
	} catch (error) {
		return {
			error: <p className="text-red-500">Failed to save message.</p>,
		}
	}

	const response = openai.chat.completions
		.create({
			model: 'gpt-3.5-turbo',
			messages: [
				{
					role: 'system',
					content:
						'Respond with helpful code blocks in the context of the request.',
				},
				{
					role: 'assistant',
					content: initialMessage,
				},
				...messages.map(({ author, text }) => {
					switch (author) {
						case 'Me':
							return { role: 'user', content: text } as const
						case 'Bot':
							return { role: 'assistant', content: text } as const
						default:
							throw new Error(`Invalid author: ${author}`)
					}
				}),
				{ role: 'user', content: text },
			],
			stream: true,
		})
		.then((stream) => {
			return (
				<React.Suspense fallback="...">
					<ChatMessage
						stream={stream[Symbol.asyncIterator]()}
						onDone={(message) => {
							db.prepare(
								'INSERT INTO message (chatId, author, text) VALUES (?, ?, ?)',
							).run(chatId, 'Bot', message)
						}}
						author="Bot"
					/>
				</React.Suspense>
			)
		})
		.catch((error) => {
			console.error(error)
			return <p className="text-red-500">Failed to generate completion.</p>
		})

	return {
		message: <ChatMessage text={text} author="Me" />,
		response,
	}
}

async function chatHandler(c: Context) {
	let sendMessageResult: ReturnType<typeof sendMessage> | null = null
	const messages = db
		.query<{ id: number; author: string; text: string }, number>(
			'SELECT id, author, text FROM message WHERE chatId = ?',
		)
		.all(1)

	if (c.req.method === 'POST') {
		const formData = await c.req.formData()
		sendMessageResult = sendMessage(formData, messages)
	}

	const stream = await renderToReadableStream(
		<Document>
			<ChatView chatId={1}>
				<ChatMessage text={initialMessage} author="Bot" />
				{messages.map(({ id, author, text }) => (
					<ChatMessage key={id} text={text} author={author} />
				))}
				{sendMessageResult?.message || sendMessageResult?.error}
				{sendMessageResult?.response && (
					<PendingChatMessage author="Bot">
						{sendMessageResult.response}
					</PendingChatMessage>
				)}
			</ChatView>
		</Document>,
		{
			onError: console.error,
			signal: c.req.raw.signal,
		},
	)

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/html',
			'Transfer-Encoding': 'chunked',
		},
	})
}

app.get('/static/*', serveStatic())
app.get('/', chatHandler)
app.post('/', chatHandler)
app.post('/chat/completion', async (c) => {
	const messages = db
		.query<{ id: number; author: string; text: string }, number>(
			'SELECT id, author, text FROM message WHERE chatId = ?',
		)
		.all(1)

	const formData = await c.req.formData()
	const sendMessageResult = sendMessage(formData, messages)

	const stream = await renderToReadableStream(
		<>
			{sendMessageResult?.message || sendMessageResult?.error}
			{sendMessageResult?.response && (
				<PendingChatMessage author="Bot">
					{sendMessageResult.response}
				</PendingChatMessage>
			)}
		</>,
		{
			onError: console.error,
			signal: c.req.raw.signal,
		},
	)

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/html',
			'Transfer-Encoding': 'chunked',
		},
	})
})

export default app
