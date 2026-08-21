import { Injectable } from '@angular/core';
import {HttpClient,HttpHeaders} from '@angular/common/http'
import { Debug } from '../models/Debug';
import {Observable} from 'rxjs';

@Injectable({
  providedIn: 'root'
})

export class SFAPIService {
  
  constructor(private http:HttpClient) { 
    
  }

  updateTF(credentials,TF):Observable<any>{
    const headers = new HttpHeaders()
    .set("Authorization", "Bearer "+credentials.access_token)
    .set('Content-Type', 'application/json');
    //var url = "https://zi--fullbox1.my.salesforce.com/services/data/v60.0/tooling/query/?q=SELECT+id+from+ApexLog";
    var url = credentials.instance_url + '/services/data/v60.0/tooling/sobjects/TraceFlag/'+TF.Id;
    delete TF.Id; 
    return this.http.patch<any>(url,TF,{headers});
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
    const headers = new HttpHeaders()
    .set("Authorization", "Bearer "+credentials.access_token)
    .set('Content-Type', 'application/json');
    //var url = "https://zi--fullbox1.my.salesforce.com/services/data/v60.0/tooling/query/?q=SELECT+id+from+ApexLog";
    var url = credentials.instance_url+'/services/data/v60.0/tooling/query/?q=select+id+,+DeveloperName+from+DebugLevel';
    return this.http.get<any>(url,{headers});
  }

  createTraceFlag(traceFlag,credentials):Observable<any>{
    const headers = new HttpHeaders()
    .set("Authorization", "Bearer "+credentials.access_token)
    .set('Content-Type', 'application/json');
    //var url = "https://zi--fullbox1.my.salesforce.com/services/data/v60.0/tooling/query/?q=SELECT+id+from+ApexLog";
    var url = credentials.instance_url+"/services/data/v60.0/tooling/sobjects/TraceFlag/";
    return this.http.post<any>(url,traceFlag,{headers});
  }



  searchForUser(userName,credentials):Observable<any>{
    const headers = new HttpHeaders()
    .set("Authorization", "Bearer "+credentials.access_token)
    .set('Content-Type', 'application/json');
    //var url = "https://zi--fullbox1.my.salesforce.com/services/data/v60.0/tooling/query/?q=SELECT+id+from+ApexLog";
    var url = credentials.instance_url+"/services/data/v60.0/tooling/query/?q=SELECT+id+,+name+from+user+where+name+like+'"+userName+"%25' ";
    return this.http.get<any>(url,{headers});
  }

  toolingApiDeleteOne(id,credentials):Observable<any>{
    const headers = new HttpHeaders()
    .set("Authorization", "Bearer "+credentials.access_token)
    .set('Content-Type', 'application/json');
    //var url = "https://zi--fullbox1.my.salesforce.com/services/data/v60.0/tooling/query/?q=SELECT+id+from+ApexLog";
    var url = credentials.instance_url+'/services/data/v60.0/tooling/sobjects/TraceFlag/'+id;
    return this.http.delete<any>(url,{headers});
  }

 /* toolingApiDelete(Ids,credentials):Observable<any>{
    
    const requestOptions: Object = {
      headers: new HttpHeaders().append("Authorization", "Bearer "+credentials.access_token),
      responseType: 'text'
    }
    //'/services/data/v60.0/tooling/sobjects/TraceFlag/'+logIds.join();
    var url = credentials.instance_url+'/services/data/v60.0/tooling/composite/sobjects?ids='+Ids.join();
    return this.http.delete<string>(url,requestOptions);
  }*/

  deleteLogs(logIds,credentials):Observable<any>{
    const requestOptions: Object = {
      headers: new HttpHeaders().append("Authorization", "Bearer "+credentials.access_token),
      responseType: 'text'
    }
    var url = credentials.instance_url+'/services/data/v60.0/composite/sobjects?allOrNone=false&ids='+logIds.join();
    return this.http.delete<string>(url,requestOptions);
  }

  downloadLog(logId,credentials){
    window.open(credentials.instance_url+"/servlet/servlet.FileDownload?file="+logId,'_blank', 'toolbar=no,status=no,menubar=no,scrollbars=no,resizable=no,left=10000, top=10000, width=10, height=10, visible=none',false);
    
  }

  getAllLogsAmount(credentials):Observable<any>{
    console.log('inside getAllLogsAmount');
    const headers = new HttpHeaders()
    .set("Authorization", "Bearer "+credentials.access_token)
    .set('Content-Type', 'application/json');
    
    var url = credentials.instance_url+'/services/data/v60.0/tooling/query/?q=SELECT+count(id)+from+apexlog';
    return this.http.get<any>(url,{headers});
  }

  getLogText(logId,credentials):Observable<string>{
    console.log('inside getLogText');
    const requestOptions: Object = {
      headers: new HttpHeaders().append("Authorization", "Bearer "+credentials.access_token),
      responseType: 'text'
    }
    var url = credentials.instance_url+'/services/data/v60.0/tooling/sobjects/ApexLog/'+logId+'/Body';
    return this.http.get<string>(url,requestOptions);
  }


  getLogs(credentials):Observable<any>{
    const headers = new HttpHeaders()
    .set("Authorization", "Bearer "+credentials.access_token)
    .set('Content-Type', 'application/json');
    
    var url = credentials.instance_url+'/services/data/v60.0/tooling/query/?q=select+id+,+LogLength+,+LogUser.Name+,+LogUser.Id+,+LastModifiedDate+,+Operation+,+StartTime+,+Request+,+Status+,+SystemModstamp+,+DurationMilliseconds+,+Application+,+Location+from+apexlog+order+by+StartTime+desc ';
    return this.http.get<any>(url,{headers});
  }

  getTraceFlags(credentials):Observable<any>{
    const headers = new HttpHeaders()
    .set("Authorization", "Bearer "+credentials.access_token)
    .set('Content-Type', 'application/json');
    
    var url = credentials.instance_url+'/services/data/v60.0/tooling/query/?q=SELECT+id+,+ExpirationDate+,+StartDate+,+TracedEntity.id+,+TracedEntity.Name+,+DebugLevel.DeveloperName+,+DebugLevel.Id+from+TraceFlag';
    return this.http.get<any>(url,{headers});
  }

  getUserDetatils(credentials):Observable<any>{
    const headers = new HttpHeaders()
    .set("Authorization", "Bearer "+credentials.access_token)
    .set('Content-Type', 'application/json');
    
    var url = credentials.instance_url+'/services/data/v60.0/chatter/users/me';
    return this.http.get<any>(url,{headers});
  }

  modifiedUserCountry(credentials,user):Observable<any>{
    const headers = new HttpHeaders()
    .set("Authorization", "Bearer "+credentials.access_token)
    .set('Content-Type', 'application/json');
    
    var url = credentials.instance_url+"/services/data/v60.0/sobjects/user/"+user.id+"/";
    return this.http.patch<any>(url,{"Country":user.Country},{headers});
  }

  getUserDetatilsById(credentials,id):Observable<any>{
    const headers = new HttpHeaders()
    .set("Authorization", "Bearer "+credentials.access_token)
    .set('Content-Type', 'application/json');
    
    var url = credentials.instance_url+"/services/data/v60.0/sobjects/user/"+id+"/";
    return this.http.get<any>(url,{headers});
  }
  getOrgDetatils(credentials):Observable<any>{
    const headers = new HttpHeaders()
    .set("Authorization", "Bearer "+credentials.access_token)
    .set('Content-Type', 'application/json');
   
    var url = credentials.instance_url+'/services/data/v60.0/query?q=SELECT+IsSandbox+,+Name+,+OrganizationType+FROM+Organization';
    return this.http.get<any>(url,{headers});
  }
  
}
