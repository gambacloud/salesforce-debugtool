import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class LogAnalyzerService {

  open(logText: string, fileName: string): void {
    const analyzerWindow = window.open('assets/log-analyzer/index.html', '_blank');
    if (!analyzerWindow) {
      console.error('Popup blocked: allow popups for this site to use the log analyzer.');
      return;
    }
    const targetOrigin = window.location.origin;
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== analyzerWindow || event.origin !== targetOrigin) return;
      if (event.data && event.data.type === 'sfdc-log-analyzer:ready') {
        analyzerWindow.postMessage({ type: 'sfdc-log-analyzer:load', text: logText, fileName }, targetOrigin);
        window.removeEventListener('message', handleMessage);
      }
    };
    window.addEventListener('message', handleMessage);
  }
}
