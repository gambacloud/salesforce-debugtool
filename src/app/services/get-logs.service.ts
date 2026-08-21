import { Injectable } from '@angular/core';
import {HttpClient,HttpHeaders} from '@angular/common/http'
import { Debug } from '../models/Debug';
import {Observable} from 'rxjs';
@Injectable({
  providedIn: 'root'
})
export class GetLogsService {
  
  constructor(private http:HttpClient) { 

  }
  downloadLog(logId,token):Observable<string>{
    const requestOptions: Object = {
      headers: new HttpHeaders().append("Authorization", "Bearer "+token),
      responseType: 'text'
    }

    /*const headers = new HttpHeaders()
    .set("Authorization", "Bearer 00D3I0000000QWj!AQkAQD8gFeJC.XsekG8WXMkpO9I.HU8nYvdprCvPkGe1csR_gUAHapGLhJ2TTegfHZY6zqaAkDRFaQaVgpF.kwJmBKWWN4tB")
    .set('Content-Type', 'text/plain; charset=utf-8');*/
    //var url = "https://zi--fullbox1.my.salesforce.com/services/data/v60.0/tooling/query/?q=SELECT+id+from+ApexLog";
    var url = 'https://zi--fullbox1.my.salesforce.com/services/data/v60.0/tooling/sobjects/ApexLog/'+logId+'/Body';
    return this.http.get<string>(url,requestOptions);
  }

  getLogs(token):Observable<any>{
    const headers = new HttpHeaders()
    .set("Authorization", "Bearer "+token)
    .set('Content-Type', 'application/json');
    //var url = "https://zi--fullbox1.my.salesforce.com/services/data/v60.0/tooling/query/?q=SELECT+id+from+ApexLog";
    var url = 'https://zi--fullbox1.my.salesforce.com/services/data/v60.0/tooling/query/?q=select+id+,+LogLength+,+LogUser.Name+,+LogUser.Id+,+LastModifiedDate+,+Operation+,+StartTime+,+Request+,+Status+,+SystemModstamp+,+DurationMilliseconds+,+Application+,+Location+from+apexlog';
    return this.http.get<any>(url,{headers});
   /* return  [
      {
        "Id" : "07L3I000003IeIhUAK",
        "LogLength" : 4505989,
        "LogUser" : {
          "Name" : "Tomer Ulman",
          "Id" : "0053I000000lbjSQAQ"
        },
        "LastModifiedDate" : "2020-09-01T08:19:44.000+0000",
        "Operation" : "/aura",
        "StartTime" : "2020-09-01T08:19:13.000+0000",
        "Request" : "Application",
        "Status" : "Success",
        "SystemModstamp" : "2020-09-01T08:19:44.000+0000",
        "DurationMilliseconds" : 30958,
        "Application" : "Browser",
        "Location" : "Monitoring"
      }, {
        
        "Id" : "07L3I000003IeIwUAK",
        "LogLength" : 6610,
        "LogUser" : {
          
          "Name" : "Tomer Ulman",
          "Id" : "0053I000000lbjSQAQ"
        },
        "LastModifiedDate" : "2020-09-01T08:19:46.000+0000",
        "Operation" : "/aura",
        "StartTime" : "2020-09-01T08:19:46.000+0000",
        "Request" : "Application",
        "Status" : "Success",
        "SystemModstamp" : "2020-09-01T08:19:46.000+0000",
        "DurationMilliseconds" : 859,
        "Application" : "Browser",
        "Location" : "Monitoring"
      }, {
        "Id" : "07L3I000003IeRUUA0",
        "LogLength" : 3558,
        "LogUser" : {
          "Name" : "Tomer Ulman",
          "Id" : "0053I000000lbjSQAQ"
        },
        "LastModifiedDate" : "2020-09-01T08:31:08.000+0000",
        "Operation" : "/aura",
        "StartTime" : "2020-09-01T08:31:08.000+0000",
        "Request" : "Application",
        "Status" : "Success",
        "SystemModstamp" : "2020-09-01T08:31:08.000+0000",
        "DurationMilliseconds" : 144,
        "Application" : "Browser",
        "Location" : "Monitoring"
      }
    ];*/
  }
}
