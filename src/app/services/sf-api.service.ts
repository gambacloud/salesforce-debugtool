import { Injectable } from '@angular/core';
import {HttpClient,HttpHeaders} from '@angular/common/http'
import { Debug } from '../models/Debug';
import {Observable} from 'rxjs';
import {switchMap, shareReplay} from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})

export class SFAPIService {

  // Cached so /api/config is only fetched once, however many SFDC calls fire.
  private config$: Observable<any>;

  constructor(private http:HttpClient) {
    this.config$ = this.http.get<any>('/api/config').pipe(shareReplay(1));
  }

  // Everything below routes through /api/proxy/* (same-origin, no CORS
  // whitelisting needed) when the SF_API_USE_PROXY Heroku config var is on,
  // and calls the org directly like before when it's off.
  private useProxy():Observable<boolean>{
    return this.config$.pipe(switchMap(cfg => [!!cfg.sfApiUseProxy]));
  }

  updateTF(credentials,TF):Observable<any>{
    const id = TF.Id;
    delete TF.Id;
    return this.useProxy().pipe(switchMap(proxy => {
      if (proxy) {
        return this.http.patch<any>(`/api/proxy/tooling/sobject/TraceFlag/${id}`,
          {instanceUrl: credentials.instance_url, sessionId: credentials.access_token, record: TF});
      }
      const headers = new HttpHeaders()
        .set("Authorization", "Bearer "+credentials.access_token)
        .set('Content-Type', 'application/json');
      var url = credentials.instance_url + '/services/data/v60.0/tooling/sobjects/TraceFlag/'+id;
      return this.http.patch<any>(url,TF,{headers});
    }));
  }
  //SELECT id,DeveloperName from DebugLevel

  RealGmtToLocal(offset,gmtDate){
    return new Date(new Date(gmtDate).getTime() + offset);
  }
  toRealGmt(offset,date){
    return new Date(date.getTime() - offset);
  }

  getGmtOffset(localDate,gmtDate){
    return localDate -new Date(gmtDate).getTime() ;
  }

  getGMT():Observable<any>{
    const headers = new HttpHeaders()
    .set('Content-Type', 'application/json');
    return this.http.get<any>('http://worldclockapi.com/api/json/utc/now',{headers});
  }

  getLogLevels(credentials):Observable<any>{
    return this.toolingQuery(credentials, 'select+id+,+DeveloperName+from+DebugLevel');
  }

  createTraceFlag(traceFlag,credentials):Observable<any>{
    return this.useProxy().pipe(switchMap(proxy => {
      if (proxy) {
        return this.http.post<any>('/api/proxy/tooling/sobject/TraceFlag',
          {instanceUrl: credentials.instance_url, sessionId: credentials.access_token, record: traceFlag});
      }
      const headers = new HttpHeaders()
        .set("Authorization", "Bearer "+credentials.access_token)
        .set('Content-Type', 'application/json');
      var url = credentials.instance_url+"/services/data/v60.0/tooling/sobjects/TraceFlag/";
      return this.http.post<any>(url,traceFlag,{headers});
    }));
  }

  searchForUser(userName,credentials):Observable<any>{
    return this.toolingQuery(credentials, "SELECT+id+,+name+from+user+where+name+like+'"+userName+"%25' ");
  }

  toolingApiDeleteOne(id,credentials):Observable<any>{
    return this.useProxy().pipe(switchMap(proxy => {
      if (proxy) {
        const params = new URLSearchParams({instanceUrl: credentials.instance_url, sessionId: credentials.access_token});
        return this.http.delete<any>(`/api/proxy/tooling/sobject/TraceFlag/${id}?${params}`);
      }
      const headers = new HttpHeaders()
        .set("Authorization", "Bearer "+credentials.access_token)
        .set('Content-Type', 'application/json');
      var url = credentials.instance_url+'/services/data/v60.0/tooling/sobjects/TraceFlag/'+id;
      return this.http.delete<any>(url,{headers});
    }));
  }

  deleteLogs(logIds,credentials):Observable<any>{
    return this.useProxy().pipe(switchMap(proxy => {
      if (proxy) {
        const params = new URLSearchParams({instanceUrl: credentials.instance_url, sessionId: credentials.access_token, ids: logIds.join()});
        return this.http.delete<string>(`/api/proxy/sobjects?${params}`);
      }
      const requestOptions: Object = {
        headers: new HttpHeaders().append("Authorization", "Bearer "+credentials.access_token),
        responseType: 'text'
      }
      var url = credentials.instance_url+'/services/data/v60.0/composite/sobjects?allOrNone=false&ids='+logIds.join();
      return this.http.delete<string>(url,requestOptions);
    }));
  }

  downloadLog(logId,credentials){
    // Plain browser navigation against the org's own session cookie, not an
    // XHR/fetch call - not subject to CORS, so this stays direct either way.
    window.open(credentials.instance_url+"/servlet/servlet.FileDownload?file="+logId,'_blank', 'toolbar=no,status=no,menubar=no,scrollbars=no,resizable=no,left=10000, top=10000, width=10, height=10, visible=none',false);

  }

  getAllLogsAmount(credentials):Observable<any>{
    return this.toolingQuery(credentials, 'SELECT+count(id)+from+apexlog');
  }

  getLogText(logId,credentials):Observable<string>{
    return this.useProxy().pipe(switchMap(proxy => {
      if (proxy) {
        const params = new URLSearchParams({instanceUrl: credentials.instance_url, sessionId: credentials.access_token});
        return this.http.get(`/api/proxy/tooling/sobject/ApexLog/${logId}/Body?${params}`, {responseType: 'text'});
      }
      const requestOptions: Object = {
        headers: new HttpHeaders().append("Authorization", "Bearer "+credentials.access_token),
        responseType: 'text'
      }
      var url = credentials.instance_url+'/services/data/v60.0/tooling/sobjects/ApexLog/'+logId+'/Body';
      return this.http.get<string>(url,requestOptions);
    }));
  }

  getLogs(credentials):Observable<any>{
    return this.toolingQuery(credentials, 'select+id+,+LogLength+,+LogUser.Name+,+LogUser.Id+,+LastModifiedDate+,+Operation+,+StartTime+,+Request+,+Status+,+SystemModstamp+,+DurationMilliseconds+,+Application+,+Location+from+apexlog+order+by+StartTime+desc ');
  }

  getTraceFlags(credentials):Observable<any>{
    return this.toolingQuery(credentials, 'SELECT+id+,+ExpirationDate+,+StartDate+,+TracedEntity.id+,+TracedEntity.Name+,+DebugLevel.DeveloperName+,+DebugLevel.Id+from+TraceFlag');
  }

  getUserDetatils(credentials):Observable<any>{
    return this.useProxy().pipe(switchMap(proxy => {
      if (proxy) {
        const params = new URLSearchParams({instanceUrl: credentials.instance_url, sessionId: credentials.access_token});
        return this.http.get<any>(`/api/proxy/chatter/me?${params}`);
      }
      const headers = new HttpHeaders()
        .set("Authorization", "Bearer "+credentials.access_token)
        .set('Content-Type', 'application/json');
      var url = credentials.instance_url+'/services/data/v60.0/chatter/users/me';
      return this.http.get<any>(url,{headers});
    }));
  }

  modifiedUserCountry(credentials,user):Observable<any>{
    return this.useProxy().pipe(switchMap(proxy => {
      if (proxy) {
        return this.http.patch<any>(`/api/proxy/sobject/user/${user.id}`,
          {instanceUrl: credentials.instance_url, sessionId: credentials.access_token, record: {"Country": user.Country}});
      }
      const headers = new HttpHeaders()
        .set("Authorization", "Bearer "+credentials.access_token)
        .set('Content-Type', 'application/json');
      var url = credentials.instance_url+"/services/data/v60.0/sobjects/user/"+user.id+"/";
      return this.http.patch<any>(url,{"Country":user.Country},{headers});
    }));
  }

  getUserDetatilsById(credentials,id):Observable<any>{
    return this.useProxy().pipe(switchMap(proxy => {
      if (proxy) {
        const params = new URLSearchParams({instanceUrl: credentials.instance_url, sessionId: credentials.access_token});
        return this.http.get<any>(`/api/proxy/sobject/user/${id}?${params}`);
      }
      const headers = new HttpHeaders()
        .set("Authorization", "Bearer "+credentials.access_token)
        .set('Content-Type', 'application/json');
      var url = credentials.instance_url+"/services/data/v60.0/sobjects/user/"+id+"/";
      return this.http.get<any>(url,{headers});
    }));
  }

  getOrgDetatils(credentials):Observable<any>{
    return this.useProxy().pipe(switchMap(proxy => {
      if (proxy) {
        const params = new URLSearchParams({instanceUrl: credentials.instance_url, sessionId: credentials.access_token});
        // q kept out of URLSearchParams: it uses literal "+" as the SOQL
        // space encoding (Salesforce's raw query-string convention), which
        // URLSearchParams would otherwise re-escape to "%2B" and corrupt.
        return this.http.get<any>(`/api/proxy/query?${params}&q=SELECT+IsSandbox+,+Name+,+OrganizationType+FROM+Organization`);
      }
      const headers = new HttpHeaders()
        .set("Authorization", "Bearer "+credentials.access_token)
        .set('Content-Type', 'application/json');
      var url = credentials.instance_url+'/services/data/v60.0/query?q=SELECT+IsSandbox+,+Name+,+OrganizationType+FROM+Organization';
      return this.http.get<any>(url,{headers});
    }));
  }

  private toolingQuery(credentials, q:string):Observable<any>{
    return this.useProxy().pipe(switchMap(proxy => {
      if (proxy) {
        const params = new URLSearchParams({instanceUrl: credentials.instance_url, sessionId: credentials.access_token, q});
        return this.http.get<any>(`/api/proxy/tooling/query?${params}`);
      }
      const headers = new HttpHeaders()
        .set("Authorization", "Bearer "+credentials.access_token)
        .set('Content-Type', 'application/json');
      var url = credentials.instance_url+'/services/data/v60.0/tooling/query/?q='+q;
      return this.http.get<any>(url,{headers});
    }));
  }

}
