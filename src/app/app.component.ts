import { Component ,OnInit, ViewChild, AfterViewInit } from '@angular/core';
import { DebugTableComponent } from './components/debug-table/debug-table.component';
import {MatTabsModule} from '@angular/material/tabs';
import { Title } from '@angular/platform-browser';
import { SFAPIService } from './services/sf-api.service';
import { MatIconRegistry } from "@angular/material/icon";
import { DomSanitizer } from "@angular/platform-browser";
import {FormControl} from '@angular/forms';
import { DataService } from "./services/data.service";
import { Subscription } from 'rxjs';
import { debuglog } from 'util';
import { Debug } from './models/Debug';
@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit{

  @ViewChild(DebugTableComponent) debugTableComponent;
  subscription: Subscription;
  fronDorLink:string;
  User:Object;
  Org:Object;
  GMToffSet :number;
  Debugs:Debug[];
  token:string;
  hasCORSerror = false;
  credentials:Object;
  logTabs = [];
  selected = new FormControl(0);
  ngAfterViewInit() {
    //this.Debugs = this.debugTableComponent.Debugs
  }
  ngOnInit() {
    //this.subscription = this.data.currentMessage.subscribe(debuglog =>this.logTabs.push(debuglog) );
    this.subscription = this.data.currentMessage.subscribe(debuglog =>{
      if(debuglog != ''){
        this.Debugs = this.debugTableComponent.Debugs
        if( this.logTabs.filter(log=>{return log.Id == debuglog['Id'];}).length < 1){
          this.logTabs.push(debuglog);
          this.selected.setValue(this.logTabs.length + 1);
        }else{
          var index = this.logTabs.map(function(e) { return e.Id; }).indexOf(debuglog['Id']);
          console.log('### log index',index)
          this.selected.setValue(index + 2);
        }
      }
    } );
  }
  constructor(private titleService: Title ,private SFAPIService:SFAPIService,private data: DataService) {
    var that = this;
  
    

    this.titleService.setTitle( 'Debbug Tool' );
    this.credentials = {}; 
    var url = new URL(window.location.href.replace('#', '?'));
    this.credentials['access_token'] =  this.token = url.searchParams.get("access_token");
    if(location.hostname !== "localhost")
      window.history.pushState({}, document.title,"");
    var instance_url = this.credentials['instance_url'] =  url.searchParams.get("instance_url");
    if(instance_url){
      this.credentials['org']  = instance_url.substring(
        instance_url.lastIndexOf("/") + 1, 
        instance_url.indexOf(".")
      );
      this.fronDorLink = instance_url+"/secur/frontdoor.jsp?sid="+this.credentials['access_token'];
      this.SFAPIService.getUserDetatils(this.credentials).subscribe(user => {
        console.log('user res',user);
        that.User = user;

        this.SFAPIService.modifiedUserCountry(this.credentials,that.User).subscribe(res => {
          var datebeforeUpdate = new Date();
          this.SFAPIService.getUserDetatilsById(this.credentials,that.User['id']).subscribe(ModifiedUser => {
            
            this.GMToffSet = this.SFAPIService.getGmtOffset(datebeforeUpdate, ModifiedUser.LastModifiedDate) ;
            console.log('GMToffSet',this.GMToffSet);
          });
        });
        //this.Debugs = logs.records;
      } ,err => {
        this.hasCORSerror = true;
      });
      this.SFAPIService.getOrgDetatils(this.credentials).subscribe(org => {
        console.log(' org info',org);
        that.Org = org.records[0];
        //this.Debugs = logs.records;
      });
      
      /*this.SFAPIService.getGMT().subscribe(gmt => {
      
        this.GMToffSet = this.SFAPIService.getGmtOffset(new Date(), gmt.currentDateTime) ;
        console.log('GMToffSet',this.GMToffSet);
      });*/
      //this.GMToffSet = new Date().getTimezoneOffset() ;
      //console.log("@@@ GMToffSet",this.GMToffSet);
    }
    
    console.log('token',this.token);
    this.initTheme();
  }

  currentTheme: 'old' | 'new' = 'old';

  initTheme(): void {
    const saved = localStorage.getItem('ui-theme') as 'old' | 'new';
    this.currentTheme = saved || 'old';
    if (this.currentTheme === 'new') document.body.classList.add('theme-new');
  }

  toggleTheme(): void {
    this.currentTheme = this.currentTheme === 'old' ? 'new' : 'old';
    document.body.classList.toggle('theme-new', this.currentTheme === 'new');
    localStorage.setItem('ui-theme', this.currentTheme);
  }

  addTab(selectAfterAdding: boolean) {
    this.logTabs.push('New');

    if (selectAfterAdding) {
      this.selected.setValue(this.logTabs.length - 1);
    }
  }

  removeTab(index: number) {
    this.logTabs.splice(index, 1);
  }

}
