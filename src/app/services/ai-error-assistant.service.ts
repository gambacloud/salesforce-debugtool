import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AiErrorAssistantService {

  open(logText: string, fileName: string, credentials?: any): void {
    const assistantWindow = window.open('assets/ai-error-assistant/index.html', '_blank');
    if (!assistantWindow) {
      console.error('Popup blocked: allow popups for this site to use AI Error Assistance.');
      return;
    }
    const targetOrigin = window.location.origin;
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== assistantWindow || event.origin !== targetOrigin) return;
      if (event.data && event.data.type === 'sfdc-ai-error-assist:ready') {
        assistantWindow.postMessage({
          type: 'sfdc-ai-error-assist:load',
          text: logText,
          fileName,
          instanceUrl: credentials ? credentials.instance_url : null,
          accessToken: credentials ? credentials.access_token : null,
        }, targetOrigin);
        window.removeEventListener('message', handleMessage);
      }
    };
    window.addEventListener('message', handleMessage);
  }
}
