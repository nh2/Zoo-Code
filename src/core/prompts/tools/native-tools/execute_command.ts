import type OpenAI from "openai"

const EXECUTE_COMMAND_DESCRIPTION = `Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. You must tailor your command to the user's system and provide a clear explanation of what the command does. For command chaining, use the appropriate chaining syntax for the user's shell. Prefer to execute complex CLI commands over creating executable scripts, as they are more flexible and easier to run. Prefer relative commands and paths that avoid location sensitivity for terminal consistency.

Parameters:
- command: (required) The CLI command to execute. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.
- cwd: (optional) The working directory to execute the command in
- timeout: (optional) Timeout in seconds. When exceeded, the command keeps running in the background and you receive the output so far. Set this for commands that may run indefinitely, such as dev servers or file watchers, so you can proceed without waiting for them to exit.
- allow_repeat: (optional) Set to true when you expect to run this exact command (same command and cwd) repeatedly during this task, e.g. a deployment, status check, or test run you will re-run after each change. The user is then offered to allow it for the rest of the task. The tool result tells you whether they did; only then may you assume that re-running it needs no approval. The user can revoke the allowance at any time, and you will be told when they do.

Example: Executing npm run dev
{ "command": "npm run dev", "cwd": null, "timeout": null, "allow_repeat": null }

Example: Executing ls in a specific directory if directed
{ "command": "ls -la", "cwd": "/home/user/projects", "timeout": null, "allow_repeat": null }

Example: Using relative paths
{ "command": "touch ./testdata/example.file", "cwd": null, "timeout": null, "allow_repeat": null }

Example: Running a build with a timeout
{ "command": "npm run build", "cwd": null, "timeout": 30, "allow_repeat": null }

Example: Checking a deployment you will re-check after each change
{ "command": "systemctl status nginx", "cwd": null, "timeout": null, "allow_repeat": true }`

const COMMAND_PARAMETER_DESCRIPTION = `Shell command to execute`

const CWD_PARAMETER_DESCRIPTION = `Optional working directory for the command, relative or absolute`

const TIMEOUT_PARAMETER_DESCRIPTION = `Timeout in seconds. When exceeded, the command continues running in the background and output collected so far is returned. Use this for long-running processes like dev servers, file watchers, or any command that may not exit on its own`

const ALLOW_REPEAT_PARAMETER_DESCRIPTION = `Set true if you expect to run this exact command repeatedly during this task; the user is then offered to allow it without further approval for the rest of the task`

export default {
	type: "function",
	function: {
		name: "execute_command",
		description: EXECUTE_COMMAND_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description: COMMAND_PARAMETER_DESCRIPTION,
				},
				cwd: {
					type: ["string", "null"],
					description: CWD_PARAMETER_DESCRIPTION,
				},
				timeout: {
					type: ["number", "null"],
					description: TIMEOUT_PARAMETER_DESCRIPTION,
				},
				allow_repeat: {
					type: ["boolean", "null"],
					description: ALLOW_REPEAT_PARAMETER_DESCRIPTION,
				},
			},
			required: ["command", "cwd", "timeout", "allow_repeat"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
