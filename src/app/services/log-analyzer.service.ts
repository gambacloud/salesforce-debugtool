import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class LogAnalyzerService {

  open(logText: string, fileName: string): void {
    const analyzerWindow = window.open('', '_blank', 'width=1300,height=850');
    if (!analyzerWindow) {
      console.error('Popup blocked: allow popups for this site to use the log analyzer.');
      return;
    }
    analyzerWindow.addEventListener('load', () => {
      const file = new File([logText], fileName, { type: 'text/plain' });
      (analyzerWindow as any).analyze(file);
    });
    analyzerWindow.location.href = 'assets/log-analyzer/index.html';
  }
}
