/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/** Ass Chat configuration interface */
interface AssConfig {
	apiEndpoint: string;
	apiKey: string;
	model: string;
}

/** Chat message format */
interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

/** API response format */
interface ChatCompletionResponse {
	id: string;
	choices: Array<{
		message: {
			content: string;
		};
		delta?: {
			content?: string;
		};
		finish_reason: string | null;
	}>;
}

/**
 * Get Ass Chat configuration
 * @returns Ass configuration object
 */
function getConfig(): AssConfig {
	const config = vscode.workspace.getConfiguration('ass.chat');
	return {
		apiEndpoint: config.get<string>('apiEndpoint', 'http://localhost:8080/v1/chat/completions'),
		apiKey: config.get<string>('apiKey', ''),
		model: config.get<string>('model', 'ass-default')
	};
}

/**
 * Call backend API (streaming)
 * @param messages Message history
 * @param response VSCode Chat response stream
 * @param token Cancellation token
 */
async function callBackendStreaming(
	messages: ChatMessage[],
	response: vscode.ChatResponseStream,
	token: vscode.CancellationToken
): Promise<void> {
	const config = getConfig();

	const requestBody = {
		model: config.model,
		messages: messages,
		stream: true
	};

	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};

	if (config.apiKey) {
		headers['Authorization'] = `Bearer ${config.apiKey}`;
	}

	try {
		const fetchResponse = await fetch(config.apiEndpoint, {
			method: 'POST',
			headers: headers,
			body: JSON.stringify(requestBody),
			signal: token.isCancellationRequested ? AbortSignal.abort() : undefined
		});

		if (!fetchResponse.ok) {
			throw new Error(`API error: ${fetchResponse.status} ${fetchResponse.statusText}`);
		}

		const reader = fetchResponse.body?.getReader();
		if (!reader) {
			throw new Error('No response body');
		}

		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			if (token.isCancellationRequested) {
				reader.cancel();
				break;
			}

			const { done, value } = await reader.read();
			if (done) {
				break;
			}

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed || trimmed === 'data: [DONE]') {
					continue;
				}
				if (!trimmed.startsWith('data: ')) {
					continue;
				}

				try {
					const json = JSON.parse(trimmed.slice(6)) as ChatCompletionResponse;
					const content = json.choices[0]?.delta?.content;
					if (content) {
						response.markdown(content);
					}
				} catch {
					// Skip invalid JSON
				}
			}
		}
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			return;
		}
		throw error;
	}
}

/**
 * Call backend API (non-streaming)
 * @param messages Message history
 * @returns API response content
 */
async function callBackend(messages: ChatMessage[]): Promise<string> {
	const config = getConfig();

	const requestBody = {
		model: config.model,
		messages: messages,
		stream: false
	};

	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};

	if (config.apiKey) {
		headers['Authorization'] = `Bearer ${config.apiKey}`;
	}

	const fetchResponse = await fetch(config.apiEndpoint, {
		method: 'POST',
		headers: headers,
		body: JSON.stringify(requestBody)
	});

	if (!fetchResponse.ok) {
		throw new Error(`API error: ${fetchResponse.status} ${fetchResponse.statusText}`);
	}

	const json = await fetchResponse.json() as ChatCompletionResponse;
	return json.choices[0]?.message?.content || '';
}

/**
 * Build system prompt
 * @returns System prompt string
 */
function buildSystemPrompt(): string {
	return `You are Ass, an AI programming assistant.
You are helpful, harmless, and honest.
You help users with coding tasks, answer questions, and provide explanations.
When providing code, use markdown code blocks with appropriate language tags.
Be concise and direct in your responses.`;
}

/**
 * Handle Chat request
 * @param request Chat request
 * @param context Chat context
 * @param response Chat response stream
 * @param token Cancellation token
 * @returns Chat result
 */
async function handleChatRequest(
	request: vscode.ChatRequest,
	context: vscode.ChatContext,
	response: vscode.ChatResponseStream,
	token: vscode.CancellationToken
): Promise<vscode.ChatResult> {

	const messages: ChatMessage[] = [
		{ role: 'system', content: buildSystemPrompt() }
	];

	for (const historyItem of context.history) {
		if (historyItem instanceof vscode.ChatRequestTurn) {
			messages.push({ role: 'user', content: historyItem.prompt });
		} else if (historyItem instanceof vscode.ChatResponseTurn) {
			let content = '';
			for (const part of historyItem.response) {
				if (part instanceof vscode.ChatResponseMarkdownPart) {
					content += part.value.value;
				}
			}
			if (content) {
				messages.push({ role: 'assistant', content });
			}
		}
	}

	let userPrompt = request.prompt;
	if (request.command) {
		switch (request.command) {
			case 'explain':
				userPrompt = `Please explain the following:\n${request.prompt}`;
				break;
			case 'fix':
				userPrompt = `Please fix the issues in the following code:\n${request.prompt}`;
				break;
			case 'generate':
				userPrompt = `Please generate code for:\n${request.prompt}`;
				break;
			case 'help':
				response.markdown('# Ass Chat Help\n\n');
				response.markdown('I am Ass, your AI programming assistant. I can help you with:\n\n');
				response.markdown('- **@ass** - Ask any question\n');
				response.markdown('- **@ass /explain** - Explain code or concepts\n');
				response.markdown('- **@ass /fix** - Fix code issues\n');
				response.markdown('- **@ass /generate** - Generate code\n');
				response.markdown('- **@ass /help** - Show this help\n\n');
				response.markdown('## Configuration\n\n');
				response.markdown('Configure the backend in settings:\n');
				response.markdown('- `ass.chat.apiEndpoint` - API endpoint URL\n');
				response.markdown('- `ass.chat.apiKey` - API key (if required)\n');
				response.markdown('- `ass.chat.model` - Model name\n');
				return { metadata: { command: 'help' } };
		}
	}

	messages.push({ role: 'user', content: userPrompt });

	try {
		await callBackendStreaming(messages, response, token);
		return { metadata: { command: request.command } };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		response.markdown(`\n\n**Error:** ${errorMessage}\n\n`);
		response.markdown('Please check your configuration:\n');
		response.markdown('1. Ensure your backend is running\n');
		response.markdown('2. Check `ass.chat.apiEndpoint` setting\n');
		response.markdown('3. Verify API key if required\n');

		return {
			metadata: { command: request.command },
			errorDetails: {
				message: errorMessage
			}
		};
	}
}


/**
 * @brief Ass Authentication Provider
 */
class AssAuthenticationProvider implements vscode.AuthenticationProvider {
	private _onDidChangeSessions = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	private sessions: vscode.AuthenticationSession[] = [];

	async getSessions(_scopes?: readonly string[], _options?: vscode.AuthenticationProviderSessionOptions): Promise<vscode.AuthenticationSession[]> {
		return this.sessions;
	}

	async createSession(_scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
		const session: vscode.AuthenticationSession = {
			id: 'ass-session-' + Date.now(),
			accessToken: 'ass-token',
			account: { id: 'ass-user', label: 'Ass User' },
			scopes: []
		};
		this.sessions.push(session);
		this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });
		return session;
	}

	async removeSession(sessionId: string): Promise<void> {
		const index = this.sessions.findIndex(s => s.id === sessionId);
		if (index >= 0) {
			const removed = this.sessions.splice(index, 1);
			this._onDidChangeSessions.fire({ added: [], removed, changed: [] });
		}
	}
}

/**
 * Activate extension
 * @param context Extension context
 */
export function activate(context: vscode.ExtensionContext): void {
	console.log('Ass Chat extension is now active');

	const authProvider = new AssAuthenticationProvider();
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			'ass-provider',
			'Ass',
			authProvider,
			{ supportsMultipleAccounts: false }
		)
	);

	const participant = vscode.chat.createChatParticipant('ass.chat', handleChatRequest);

	participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');

	participant.followupProvider = {
		provideFollowups(result: vscode.ChatResult, _context: vscode.ChatContext, _token: vscode.CancellationToken): vscode.ChatFollowup[] {
			if (result.metadata?.command === 'help') {
				return [];
			}
			return [
				{ prompt: 'Can you explain more?' },
				{ prompt: 'Can you show an example?' },
				{ prompt: 'How can I improve this?' }
			];
		}
	};

	const startCommand = vscode.commands.registerCommand('ass.chat.start', () => {
		vscode.commands.executeCommand('workbench.action.chat.open');
	});

	context.subscriptions.push(participant, startCommand);
}

/**
 * Deactivate extension
 */
export function deactivate(): void {
	console.log('Ass Chat extension is now deactivated');
}
