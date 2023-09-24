import * as React from 'react'
import type openai from 'openai'

export function Document({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<title>My App</title>
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<link rel="stylesheet" href="/static/styles.css" />
				<script
					src="https://unpkg.com/htmx.org@1.9.6/dist/htmx.min.js"
					integrity="sha384-FhXw7b6AlE/jyjlZH5iHa/tTe9EpJ1Y55RjcgPbjeWMskSxZt1v9qkxLJWNJaGni"
					crossOrigin="anonymous"
				/>
				<script src="/static/htmx-react-streaming.js" />
				<script
					src="https://unpkg.com/hyperscript.org@0.9.11/dist/_hyperscript.min.js"
					integrity="sha384-SWTvl6gg9wW7CzNqGD9/s3vxwaaKN2g8/eYyu0yT+rkQ/Rb/6NmjnbTi9lYNrpZ1"
					crossOrigin="anonymous"
				/>
			</head>
			<body
				hx-ext="react-streaming"
				className="relative min-h-screen min-w-screen flex flex-col"
			>
				<header className="sticky top-0 bg-fuchsia-500 text-white text-center py-4">
					<h1>GPT Chat</h1>
				</header>
				{children}
			</body>
		</html>
	)
}

export function ChatView({
	chatId,
	children,
}: { chatId: number; children: React.ReactNode }) {
	return (
		<div className="flex flex-col-reverse flex-1 container mx-auto">
			<div className="chat-container sticky bg-white bottom-0 border-t border-gray-300">
				<form
					method="POST"
					className="flex p-4 m-0 gap-2"
					encType="application/x-www-form-urlencoded"
					react-stream="/chat/completion"
					hx-swap-oob="beforeend:.messages"
				>
					<input type="hidden" name="chatId" value={chatId} />
					<textarea
						className="flex-1 p-2 border resize-none"
						placeholder="Type your message..."
						name="text"
					/>
					<div className="flex items-end">
						<button
							type="submit"
							className="px-4 py-2 bg-fuchsia-500 text-white"
						>
							Send
						</button>
					</div>
				</form>
			</div>
			<div
				className="messages flex-1 overflow-y-auto p-4 pb-24"
				_="
          on load
            go to the bottom of me
            focus() the previous <textarea/>
          end
					on mutation of anything
						go to the bottom of me
					end
        "
			>
				{children}
			</div>
		</div>
	)
}

async function StreamingText({
	stream,
	onChunk,
}: {
	stream: AsyncIterator<
		openai.Chat.Completions.ChatCompletionChunk,
		unknown,
		undefined
	>
	onChunk?: (chunk: string | null, done: boolean) => void
}) {
	const chunk = await stream.next()
	const message = chunk.value?.choices?.[0]?.delta?.content || null

	if (onChunk) {
		onChunk(message, chunk.done || false)
	}

	return (
		<>
			{message}
			{!chunk.done && (
				<React.Suspense fallback="...">
					<StreamingText stream={stream} onChunk={onChunk} />
				</React.Suspense>
			)}
		</>
	)
}

export function ChatMessage({
	text,
	stream,
	author,
	onDone,
}:
	| {
			author: string
			text: string
			stream?: undefined
			onDone?: undefined
	  }
	| {
			author: string
			text?: undefined
			stream: AsyncIterator<
				openai.Chat.Completions.ChatCompletionChunk,
				unknown,
				undefined
			>
			onDone?: (message: string) => void
	  }) {
	let element: React.ReactNode = text
	const chunks: string[] = []

	if (stream) {
		element = (
			<React.Suspense fallback="...">
				<StreamingText
					stream={stream}
					onChunk={(chunk, done) => {
						if (chunk) {
							chunks.push(chunk)
						}
						if (done) {
							onDone?.(chunks.join(''))
						}
					}}
				/>
			</React.Suspense>
		)
	}

	return (
		<div className="chat-message flex my-2">
			<span className="mr-2 font-bold border-r border-fuchsia-500 w-full max-w-[40px]">
				{author}:
			</span>
			<pre className="text-gray-700 whitespace-pre-wrap break-words">
				{element}
			</pre>
		</div>
	)
}

export function PendingChatMessage({
	author,
	children,
}: { author: string; children: React.ReactNode }) {
	return (
		<React.Suspense fallback={<ChatMessage text="..." author={author} />}>
			{children}
		</React.Suspense>
	)
}
