import { ServerMessage, ClientMessage } from '../../poker/types';

type MessageHandler = (msg: ServerMessage) => void;

export class WebSocketService {
    private ws: WebSocket | null = null;
    private listeners: MessageHandler[] = [];
    private queue: ClientMessage[] = [];
    private isConnected: boolean = false;
    private closeTimeout: any = null;

    public connect(onMessage: MessageHandler) {
        // If we were about to close, cancel it
        if (this.closeTimeout) {
            clearTimeout(this.closeTimeout);
            this.closeTimeout = null;
            console.log('WS: Close cancelled, reusing connection');
        }

        this.listeners.push(onMessage);

        if (this.ws) {
            console.log('WS: Reusing existing connection');
            return () => this.unsubscribe(onMessage);
        }

        // Reset state
        this.isConnected = false;

        // @ts-ignore
        const initData = window.Telegram?.WebApp?.initData;
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const host = window.location.host;
        const url = `${protocol}://${host}/ws?initData=${encodeURIComponent(initData)}`;

        console.log('WS: Connecting to', url);
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log('WS: Open');
            this.isConnected = true;
            this.flushQueue();
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data) as ServerMessage;
                // console.log('WS RX:', JSON.stringify(msg));
                this.listeners.forEach(cb => cb(msg));
            } catch (e) {
                console.error('WS: Parse Error', e);
            }
        };

        this.ws.onclose = (e) => {
            console.log(`WS: Closed (Code: ${e.code})`);
            this.isConnected = false;
            this.ws = null;

            // Only reconnect if we still have active listeners
            if (this.listeners.length > 0) {
                console.log('WS: Reconnecting in 3s...');
                setTimeout(() => {
                    if (this.listeners.length > 0 && !this.ws) this.connect(this.listeners[0]); // Re-trigger connect logic
                }, 3000);
            }
        };

        this.ws.onerror = (err) => {
             console.error('WS: Error', err);
        };

        return () => this.unsubscribe(onMessage);
    }

    private unsubscribe(handler: MessageHandler) {
        this.listeners = this.listeners.filter(cb => cb !== handler);

        if (this.listeners.length === 0 && this.ws && !this.closeTimeout) {
            console.log('WS: No listeners, scheduling close in 1s...');
            this.closeTimeout = setTimeout(() => {
                if (this.listeners.length === 0 && this.ws) {
                    console.log('WS: Closing due to inactivity');
                    this.isConnected = false;
                    this.ws.close();
                    this.ws = null;
                }
                this.closeTimeout = null;
            }, 1000);
        }
    }

    public send(msg: ClientMessage) {
        if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                // console.log('WS TX:', msg);
                this.ws.send(JSON.stringify(msg));
            } catch (e) {
                console.error('WS: Send Error', e);
                this.queue.push(msg);
            }
        } else {
            console.log('WS: Queuing message', msg.type);
            this.queue.push(msg);
        }
    }

    private flushQueue() {
        while (this.queue.length > 0 && this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
            const msg = this.queue.shift();
            if(msg) {
                try {
                    this.ws.send(JSON.stringify(msg));
                } catch(e) {
                    console.error('WS: Flush Error', e);
                    this.queue.unshift(msg);
                    break;
                }
            }
        }
    }
}

export const webSocketService = new WebSocketService();
