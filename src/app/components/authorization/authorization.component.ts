import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-authorization',
  templateUrl: './authorization.component.html',
  styleUrls: ['./authorization.component.css']
})
export class AuthorizationComponent implements OnInit {

  constructor() { }

  ngOnInit(): void {
    //window.location.replace('https://test.salesforce.com/services/oauth2/authorize?response_type=token&client_id=3MVG9W4cDaFe_AanyCnLpRoUX9F4eEd5Uv7MEkfClluPLgy6uiSkzf4FJO_Cr.2IPzRFMchEMnwIXM059NTmk&redirect_uri='+window.location.origin+'&state=mystate');
    //window.location.replace('https://test.salesforce.com/services/oauth2/authorize?response_type=token&client_id=3MVG9W4cDaFe_AanyCnLpRoUX9Om_wpDKyCqwJC4avrtj.Ag.prm.oJFm8voek6AAQX9lqbANpM6kmzVEUSa7&redirect_uri=https://test.salesforce.com/services/oauth2/success&state=mystate');
  }

  PRDLogin():void{
    window.location.replace('https://login.salesforce.com/services/oauth2/authorize?response_type=token&client_id=3MVG9cHH2bfKACZZQA1CTUaBxcVq7LqNuaBjebe2JAgp45yVcYsQOyfuqdtY.NMubnAKoEL_huQns.Oj3G7kO&redirect_uri='+window.location.origin+'&state=mystate');
  }

  SBLogin():void{
    window.location.replace(this.sandboxAuthUrl());
  }

  SBLoginClear():void{
    window.location.replace(this.sandboxAuthUrl() + '&prompt=login');
  }

  private sandboxAuthUrl(): string {
    return 'https://test.salesforce.com/services/oauth2/authorize?response_type=token&client_id=3MVG9cHH2bfKACZZQA1CTUaBxcVq7LqNuaBjebe2JAgp45yVcYsQOyfuqdtY.NMubnAKoEL_huQns.Oj3G7kO&redirect_uri='+window.location.origin+'&state=mystate';
  }

  connectManual(instanceUrl: string, sessionId: string): void {
    instanceUrl = (instanceUrl || '').trim();
    sessionId = (sessionId || '').trim();
    if (!instanceUrl || !sessionId) {
      alert('Enter both Instance URL and Session ID.');
      return;
    }
    // Same query params AppComponent already reads from an OAuth redirect — it never
    // persists them (no localStorage/sessionStorage), so this only lives for the current
    // page load, same as a normal login.
    const url = new URL(window.location.origin);
    url.searchParams.set('access_token', sessionId);
    url.searchParams.set('instance_url', instanceUrl);
    window.location.href = url.toString();
  }

}
