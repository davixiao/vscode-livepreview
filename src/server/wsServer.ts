import * as vscode from 'vscode';
import * as WebSocket from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';
import { Disposable } from '../utils/dispose';
import { isFileInjectable } from '../utils/utils';
import { PathUtil } from '../utils/pathUtil';

export class WSServer extends Disposable {
	private _wss: WebSocket.Server | undefined;
	private _ws_port = 0;
	constructor() {
		super();
	}

	public get ws_port() {
		return this._ws_port;
	}

	public set ws_port(portNum: number) {
		this._ws_port = portNum;
	}

	private readonly _onConnected = this._register(
		new vscode.EventEmitter<number>()
	);
	public readonly onConnected = this._onConnected.event;

	public start(ws_port: number, basePath: string) {
		this._ws_port = ws_port;
		this.startWSServer(basePath);
	}

	public close() {
		if (this._wss != null) {
			this._wss.close();
		}
	}

	private startWSServer(basePath: string): boolean {
		this._wss = new WebSocket.Server({ port: this._ws_port });
		this._wss.on('connection', (ws: any) =>
			this.handleWSConnection(basePath, ws)
		);
		this._wss.on('error', (err: any) => this.handleWSError(basePath, err));
		this._wss.on('listening', () => this.handleWSListen());
		return true;
	}

	private handleWSError(basePath: string, err: any) {
		if (err.code == 'EADDRINUSE') {
			this._ws_port++;
			this.startWSServer(basePath);
		} else {
			console.log(`Unknown error: ${err}`);
		}
	}

	private handleWSListen() {
		console.log(`Websocket server is running on port ${this._ws_port}`);
		this._onConnected.fire(this._ws_port);
	}

	private handleWSConnection(basePath: string, ws: any) {
		ws.on('message', (message: string) => {
			const parsedMessage = JSON.parse(message);
			switch (parsedMessage.command) {
				case 'urlCheck': {
					const results = this.performTargetInjectableCheck(
						basePath,
						parsedMessage.url
					);
					if (!results.injectable) {
						const sendData = {
							command: 'foundNonInjectable',
							path: results.pathname,
						};
						ws.send(JSON.stringify(sendData));
					}
				}
			}
		});
	}

	private performTargetInjectableCheck(
		basePath: string,
		urlString: string
	): { injectable: boolean; pathname: string } {
		const url = new URL(urlString);
		let absolutePath = path.join(basePath, url.pathname);

		if (!fs.existsSync(absolutePath)) {
			absolutePath = PathUtil.DecodeLooseFilePath(absolutePath);
			if (!fs.existsSync(absolutePath)) {
				return { injectable: false, pathname: url.pathname };
			}
		}

		if (
			fs.statSync(absolutePath).isDirectory() ||
			isFileInjectable(absolutePath)
		) {
			return { injectable: true, pathname: url.pathname };
		}
		return { injectable: false, pathname: url.pathname };
	}

	public refreshBrowsers(): void {
		if (this._wss) {
			this._wss.clients.forEach((client: any) =>
				client.send(JSON.stringify({ command: 'reload' }))
			);
		}
	}
}