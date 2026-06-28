
import { ChangeDetectionStrategy, OnInit,Input,AfterViewInit, Component, ElementRef, ViewChild ,OnChanges,AfterContentChecked,AfterContentInit,EventEmitter} from '@angular/core';
import { Debug } from '../../models/Debug';
import { ActionConfig } from '../action-bar/action-bar.component';
import { GetLogsService } from '../../services/get-logs.service';
import { SFAPIService } from '../../services/sf-api.service';
import {FormControl} from '@angular/forms';
import * as JSZip from 'jszip';
import {ToasterContainerComponent, ToasterService,ToasterModule,ToasterConfig} from 'angular2-toaster';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';



@Component({
  
  selector: 'app-debug-table',
  templateUrl: './debug-table.component.html',
  styleUrls: ['./debug-table.component.css'],
  
})
export class DebugTableComponent implements OnInit  ,AfterContentChecked{
  private toasterService: ToasterService;
  public config: ToasterConfig = 
        new ToasterConfig({
            showCloseButton: true, 
            tapToDismiss: false, 
            timeout: 3000,
            animation: 'fade',
            
  });
  public selectedMoments = [];
  public GreaterThanDate = new Date();
  public EarlierThanDate =  new Date();
  OpenLogAsNewWindow = false;
  allLogsAmount;
  selectedDateFilter ='None';
  selectedLength:number;
  logDisplayCount : number;
  dateFiletreForm = new FormControl();
  StatusForm = new FormControl();
  UserForm = new FormControl();
  ApplicationForm =  new FormControl();
  operationForm = new FormControl();
  @Input() GMToffSet :number;
  @Input() show :any;
  @ViewChild('searchInFilesInput') searchInFilesInput: ElementRef;
  globalSearchValue:string;
  DescOrder: boolean;
  hideUnmatched :boolean;
  Statuses: any[];
  Users: any[];
  Applications: any[];
  Operations: any[];
  selectedApplications: any[];
  selectedUsers: any[];
  selectedStatuses: any[];
  selectedOperation: any[];
  @Input() credentials:any;
  showDownLoadAllSpinner:boolean;
  showDeleteAllSpinner:boolean;
  showRefrershSpinner:boolean;
  showDeleteSelectedSpinner:boolean;
  showsearchInFilesSpinner:boolean;
  isSelectAll:boolean;
  Debugs:Debug[];

  debugActions: ActionConfig[] = [
    {
      id: 'downloadSelected',
      label: 'Download Selected',
      icon: 'save_alt',
      style: 'raised',
      variant: 'primary',
      tooltip: 'Download Selected'
    },
    {
      id: 'downloadAll',
      label: 'Download All',
      icon: 'cloud_download',
      style: 'raised',
      variant: 'primary',
      tooltip: 'Download All',
      isLoading: () => this.showDownLoadAllSpinner
    },
    { id: 'sep-dl', label: '', style: 'separator' },
    {
      id: 'deleteAll',
      label: 'Delete All',
      icon: 'delete_sweep',
      style: 'raised',
      variant: 'warn',
      tooltip: 'Delete All',
      isLoading: () => this.showDeleteAllSpinner
    },
    {
      id: 'deleteDisplaying',
      label: 'Delete Displaying',
      icon: 'delete',
      style: 'raised',
      variant: 'warn',
      tooltip: 'Delete Displaying'
    },
    {
      id: 'deleteSelected',
      label: 'Delete Selected',
      icon: 'delete',
      style: 'raised',
      variant: 'accent',
      tooltip: 'Delete Selected',
      isLoading: () => this.showDeleteSelectedSpinner
    },
    {
      id: 'deleteNotSelected',
      label: 'Delete Not Selected',
      icon: 'delete',
      style: 'raised',
      variant: 'accent',
      tooltip: 'Delete Not Selected'
    },
    {
      id: 'deleteUnmatched',
      label: 'Delete Unmatched',
      icon: 'delete',
      style: 'raised',
      variant: 'accent',
      tooltip: 'Delete Unmatched'
    }
  ];

  onActionTriggered(id: string): void {
    switch (id) {
      case 'downloadSelected':  this.downloadSelected(); break;
      case 'downloadAll':       this.downLoadZip(null); break;
      case 'deleteAll':         this.deleteAllLogs(); break;
      case 'deleteDisplaying':  this.deleteDisplayingLogs(); break;
      case 'deleteSelected':    this.deleteSelected(); break;
      case 'deleteNotSelected': this.deleteNotSelected(); break;
      case 'deleteUnmatched':   this.deleteUnmatched(); break;
    }
  }

  constructor(private SFAPIService:SFAPIService,toasterService: ToasterService ) { 
    
    this.toasterService = toasterService;
    this.DescOrder = true;
    this.hideUnmatched = false;
  }

  ngOnInit(): void {
    /*this.selectedMoments = [
      new Date(2018, 1, 12, 10, 30),
        new Date(2018, 3, 21, 20, 30)
    ];*/
    var that = this;
    this.globalSearchValue='';
    this.selectedApplications = [];
    this.selectedUsers = [];
    this.selectedStatuses = [];
    this.selectedOperation = [];
    this.SFAPIService.getAllLogsAmount(this.credentials).subscribe(res => {
      console.log('getAllLogsAmount res',res.records[0].expr0);
      this.allLogsAmount = res.records[0].expr0;
      
    });

    
      this.SFAPIService.getLogs(this.credentials).subscribe(logs => {
        
        console.log('getLogs res',logs);
        this.logDisplayCount
        logs.records.forEach(log => {
          log['textFile'] = '';
          log['color'] = '';
          log['match'] = false;
          log['machFilters'] = true;
        });
       

        //removed deleted logs
        if(logs.records && this.Debugs  && this.Debugs.length != logs.records.length){
          var refreshedLogIds = logs.records ? logs.records.map(l => l.Id) :  [];
          this.Debugs = this.Debugs.filter( function( log ) {
            return refreshedLogIds.includes( log.Id );
          } );
        }
        if(this.Debugs && this.Debugs.length > 0){
          let existingLogIds   = this.Debugs.map(l => l.Id);
          logs.records.forEach(log => {
            if(!existingLogIds.includes(log.Id))
              this.Debugs.push(log);
          });
        }
        else{
          this.Debugs = [];
          this.Debugs = logs.records;
        }
        this.logDisplayCount = this.Debugs.length;

        this.setFilters();
        this.reOrderLogs('desc');
      });
      
  }
  setFilters(){
    if (!this.Debugs || this.Debugs.length ==0)return;
  
    var statusSet = new Set(this.Debugs.map(l => l.Status));
    var usersSet = new Set(this.Debugs.map(l => l.LogUser.Name));
    var applicationSet = new Set(this.Debugs.map(l => l.Application));
    var operationSet = new Set(this.Debugs.map(l => l.Operation));
    
    this.Statuses =[];
    //this.Statuses =  Array.from(statusSet);
    statusSet.forEach(Status => {
      var cStatuseCount = this.Debugs.filter( function( log ) {
        return  log['Status']== Status;
      }).length;
      this.Statuses.push({'Status':Status,'Count':cStatuseCount})  
    });

    this.Users =[];
    //this.Users =  Array.from(usersSet);
    usersSet.forEach(user => {
      var cCount = this.Debugs.filter( function( log ) {
        return  log.LogUser.Name == user;
      }).length;
      this.Users.push({'User':user,'Count':cCount})  
    });

    this.Applications =[];
    //this.Users =  Array.from(usersSet);
    applicationSet.forEach(Application => {
      var cCount = this.Debugs.filter( function( log ) {
        return  log.Application == Application;
      }).length;
      this.Applications.push({'Application':Application,'Count':cCount})  
    });

    this.Operations =[];
    //this.Users =  Array.from(usersSet);
    operationSet.forEach(Operation => {
      var cCount = this.Debugs.filter( function( log ) {
        return  log.Operation == Operation;
      }).length;
      this.Operations.push({'Operation':Operation,'Count':cCount})  
    });

  }
  ngAfterContentChecked():void{
    
    setTimeout(_=> this.logDisplayCount = this.Debugs ? this.Debugs.filter( function( log ) {
      return  log['display']  ;
    }).length :0);
    
  }
  deleteAllLogs():void{
    
    
    var logIds = this.Debugs.map(log => log.Id);
    console.log('delete size',logIds.length);
    if(logIds.length == 0){
      this.showDeleteAllSpinner = false; 
      return ;
    }
    this.showDeleteAllSpinner = true;
    /*this.SFAPIService.deleteLogs(new Array(logIds[0]) ,this.credentials).subscribe(deletedRes => {
      console.log('deleted logs res',deletedRes);
    });*/

    this.delete200Logs(logIds);
    
  }

  delete200Logs(logIds):void{
    var ids2delete = logIds.slice(0,200);
    console.log('ids2delete',ids2delete);
    var that = this;
    this.SFAPIService.deleteLogs(ids2delete,this.credentials).subscribe(deletedRes => {
      console.log('deleted logs res',deletedRes);
      if(logIds.length >200){
        that.delete200Logs(logIds.slice(200,logIds.length));
        that.removeDeletedLocalLogs(ids2delete);
      }else{
        that.showDeleteAllSpinner = false;
        that.showDeleteSelectedSpinner = false;
        that.toasterService.pop('success', 'Delete', 'Done!');
        that.refreshLogsFromServer();
        console.log('delete logs is done');
      }
    });
  }

  refreshLogsFromServer():void{
    this.showRefrershSpinner = true;
    this.ngOnInit();
    this.showRefrershSpinner = false;
    this.toasterService.pop('success', 'Refersh', 'Done!');
  }

  removeDeletedLocalLogs(deletedLogIds):void{
    var deletedLogIdsSet =  new Set(deletedLogIds);
    this.Debugs = this.Debugs.filter(obj => !deletedLogIdsSet.has(obj.Id));
  }

  downLoadZip(logs):void{
    var that = this;
    this.showDownLoadAllSpinner = true;
    console.log('inside downLoadZip');
    if(logs == undefined){
      logs = this.Debugs.filter( function( log ) {
        return  log['display'];
      });
    }
    console.log('downlod size',logs.length);
   

    this.downloadAll(logs);

    if(this.isAllDownloadEnd(logs)){
      console.log('AllDownloadEnd');
      var zip = new JSZip();
      logs.forEach(log => {
        zip.file(log.Id+'_'+log.StartTime+".txt", log.textFile); 
      })
      
      zip.generateAsync({type:"blob"}).then(function(content) {
        //saveAs(content, "apexLogs.zip");
        var a = document.createElement('a');
        var file = new Blob([content], {type: 'application/zip'});
        a.href = URL.createObjectURL(file);
        a.download = "apexLogs.zip";
        that.showDownLoadAllSpinner = false;
        that.toasterService.pop('success', 'DownLoad', 'Done!');
        a.click();
        
      });

    }else{
      console.log('AllDownload not End');
      var that = this;
      setTimeout(function(){ that.downLoadZip(logs);}, 1000);
    }
    
  }

  downloadSelected(){
    var logs = this.Debugs.filter( function( log ) {
      return log['selected'] == true && log['display'];
    });
    if(logs.length>0)
      this.downLoadZip(logs)
  }

  isAllDownloadEnd(logs):boolean{
    var isEnd = true;
    logs.forEach(log => {
      if(!log['textFile'])
        isEnd = false;
    })
    return isEnd;
  }
  isContainsIgnoreCase(textFile,searchKey):boolean{
    return textFile.toLowerCase().indexOf(searchKey.toLowerCase()) > -1 ;
    /*var rgxp = new RegExp(searchKey, "i");
    return textFile.match(rgxp) ? true : false ;*/
  }
  downloadAll(logs):void{
    var that = this;
    logs.forEach(log => {
      if(!log['textFile']){
        log['textFileStatuse'] = 'downloading';
        this.SFAPIService.getLogText(log.Id,this.credentials).subscribe(logTextFile => {
          log['textFile'] = logTextFile;
          log['textFileStatuse'] = 'done';
          var uptodateSearchValue = this.searchInFilesInput.nativeElement.value.trim();
          if(uptodateSearchValue.trim() )
            log['color'] = that.isContainsIgnoreCase(log['textFile'],uptodateSearchValue) ? "LightGreen" : '';
            log['match'] = that.isContainsIgnoreCase(log['textFile'],uptodateSearchValue) ? true : false;
          
        });
      }
    });

  }

  searchInFiles(searchValue: string):void{
    
    var that = this;
    console.log('searchValue',searchValue);
    searchValue =searchValue.trim();
    //reset color
    
    this.Debugs.forEach(log => {
      log['color'] = '';
    })
    var logsId2search = this.Debugs.filter( function( log ) {
      return log['machFilters']  == true;
    }).map(log => log.Id);

    if( searchValue.length < 2 || logsId2search.length == 0){
      this.showsearchInFilesSpinner = false;
      return;
    } //if space return
    else{
      this.showsearchInFilesSpinner = true;
      this.Debugs.forEach(log => {

        if(!log['machFilters'] || log['machFilters'] == undefined ) return;
        console.log('test')
        if(log['textFile']){
          log['color'] = that.isContainsIgnoreCase(log['textFile'],searchValue) ? "LightGreen" : '';
          log['match'] = that.isContainsIgnoreCase(log['textFile'],searchValue) ? true : false;
          //log['color'] = log['textFile'].indexOf(searchValue) > -1 ? 'LightGreen' : '';
          console.log('log color',log['color']);
        }else if(log['textFileStatuse'] != 'downloading'){
          
          log['textFileStatuse'] = 'downloading';
          this.SFAPIService.getLogText(log.Id,this.credentials).subscribe(logTextFile => {
           
            log['textFile'] = logTextFile;
            log['textFileStatuse'] = 'done';
            var uptodateSearchValue = this.searchInFilesInput.nativeElement.value;
            //console.log('async llogTextFile',logTextFile);
            //log['color'] = log['textFile'].indexOf(uptodateSearchValue) > -1 ? 'LightGreen' : '';
            if(uptodateSearchValue.trim())
              log['color'] = that.isContainsIgnoreCase(log['textFile'],uptodateSearchValue) ? "LightGreen" : '';
              log['match'] = that.isContainsIgnoreCase(log['textFile'],uptodateSearchValue) ? true : false;
            console.log('async log color',log['color']);
           
            if( uptodateSearchValue && that.Debugs.filter( function( log ) {return log['machFilters']  == true && log['textFileStatuse'] != 'done';}).length ==0){
              
              that.showsearchInFilesSpinner = false;
              that.toasterService.pop('success', 'Search', 'Done!');
            }
          });
        }
      });
         
      if( searchValue &&  that.Debugs.filter( function( log ) {return log['machFilters']  == true && log['textFileStatuse'] != 'done';}).length ==0){
        
        that.showsearchInFilesSpinner = false;
        that.toasterService.pop('success', 'Search', 'Done!');
      }
    }
    
    //console.log('this.Debugs:',this.Debugs);
  }

  reOrderLogs(by){
    console.log('reOrderLogs',by);
    if(by == 'desc'){
      this.Debugs.sort(function(a,b){
        return new Date (b.StartTime).valueOf() - new Date(a.StartTime ).valueOf();
      });
    }else{
      this.Debugs.sort(function(a,b){
        // Turn your strings into dates, and then subtract them
        // to get a value that is either negative, positive, or zero.
        return new Date (a.StartTime).valueOf() - new Date(b.StartTime ).valueOf();
      });
    }
    this.DescOrder = !this.DescOrder;
  }

  statusSelectionChange(items){
    console.log('statusSelectionChange: ' + items);
    console.log('selectedStatuses: ' + this.selectedStatuses);
    //this.selectedStatuses = items;
    this.updateLogsFilter();
  }

  applicationSelectionChange(items){
    console.log('applicationSelectionChange: ' + items);
    
    //this.selectedApplications  = items;
    this.updateLogsFilter();
  }

  userSelectionChange(items){
    console.log('userSelectionChange: ' + items);
    //this.selectedUsers  = items;
    this.updateLogsFilter();
  }

  operationSelectionChange(items){
    console.log('oerationSelectionChange: ' + items);
    //this.selectedOperation  = items;
    this.updateLogsFilter();
  }

  resetfilters(){
    console.log('resetfilters');
    this.selectedStatuses =[];
    this.selectedUsers   =[];
    this.selectedApplications  =[];
    this.selectedOperation  =[];
    this.selectedDateFilter ='None';
    this.updateLogsFilter();
  }

  updateLogsFilter(){
    console.log('updateLogsFilter');
    
    var outStatusMatch = this.selectedStatuses.length < 1 ;
    var outuserMatch = this.selectedUsers.length <1;
    var outappMatch = this.selectedApplications.length <1;
    var outOperationMatch = this.selectedOperation.length <1;
    this.Debugs.forEach(log => {
      var dateMatch = this.isLogMatchDateFilter(log);
      var StatusMatch  = outStatusMatch || this.selectedStatuses.includes(log['Status']) ;
      var userMatch = outuserMatch || this.selectedUsers.includes(log['LogUser']['Name']);
      var appMatch = outappMatch || this.selectedApplications.includes(log['Application']) ;
      var operationMatch = outOperationMatch || this.selectedOperation.includes(log['Operation']) ;
      log['machFilters'] = dateMatch && StatusMatch &&  userMatch && appMatch && operationMatch;
      console.log('machFilters',log['machFilters']);
    });
    var that = this;
    setTimeout(() => {
      that.selectOneHandler();
    }, 500);
    this.searchInFiles(this.searchInFilesInput.nativeElement.value);
  }

  deleteFilterd(){

  }

  deleteUnFilterd(){

  }

  deleteOne(){

  }

  deleteSelected(){
    this.showDeleteSelectedSpinner = true;
    console.log('Debugs',this.Debugs);
    var selectedLogsId = this.Debugs.filter( function( log ) {
      return log['selected'] == true && log['display'];
    }).map(log => log.Id);
    if(selectedLogsId.length)
      this.delete200Logs(selectedLogsId);  
    
    
      

  }

  deleteOneNotify(finished: boolean) {
    console.log('inside deleteOneNotify');
    this.refreshLogsFromServer();
    this.toasterService.pop('success', 'Delete One', 'Done!');
  }

  selectAll(){
    console.log('inside selectAll',this.isSelectAll);
    if(this.isSelectAll){
      this.Debugs.forEach( function( log ) {
        
        if( log['display']){
          log['selected']=true;
          console.log('inside selectAll test');
        }
     });
    }else{
      this.Debugs.forEach( function( log ) {
        log['selected']=false;
     });
    }
    this.selectOneHandler();
  }
  selectOneHandler(){
    this.selectedLength = this.Debugs.filter( function( log ) {
      return log['selected'] == true && log['display'];
    }).length;
    
  }
  onDateFilterChanged(){
    console.log('selectedDateFilter',this.selectedDateFilter);
    this.selectedMoments = null;
    if(this.selectedDateFilter!='Choose-date'){
      this.updateLogsFilter();
    }
    
  }

  selectedMomentsChanged(val){
    console.log('selectedMoments',val);
    this.selectedMoments = val;
    console.log('selectedMoments',this.selectedMoments);
 
    this.updateLogsFilter();
  }

  isLogMatchDateFilter(log){
    if(this.selectedDateFilter=='None') 
      return true;
    else if(this.selectedDateFilter=='Last-hour') {
      var now = new Date(this.SFAPIService.RealGmtToLocal(this.GMToffSet,new Date())) ;
      if(log['StartTimeRealGMT'] >= now.setHours(now.getHours()-1))
        return true;
      return false;
    }
    else if(this.selectedDateFilter=='Today') {
      var now = new Date(this.SFAPIService.RealGmtToLocal(this.GMToffSet,new Date())) ;
      if(log['StartTimeRealGMT'].getDate() == now.getDate())
        return true;
      return false;
    }
    else if(this.selectedDateFilter=='Erlier-than-today') {
      var now = new Date(this.SFAPIService.RealGmtToLocal(this.GMToffSet,new Date())) ;
      if(log['StartTimeRealGMT'].getDate() < now.getDate())
        return true;
      return false;
    }
    else if(this.selectedDateFilter=='Erlier-than-This-Week') {
      var now = new Date(this.SFAPIService.RealGmtToLocal(this.GMToffSet,new Date())) ;
      var day = now.getDay();
      now.setDate(now.getDate()-day);
      if(log['StartTimeRealGMT'].getDate() < now.getDate())
        return true;
      return false;
    }
    else if(this.selectedDateFilter=='This-Week') {

      var now = new Date(this.SFAPIService.RealGmtToLocal(this.GMToffSet,new Date())) ;
      var day = now.getDay();
      now.setDate(now.getDate()-day);
      console.log('start of the week ',now.getDate());
      console.log("log['StartTimeRealGMT'].getDate()",log['StartTimeRealGMT'].getDate());
      if(log['StartTimeRealGMT'].getDate() >= now.getDate())
        return true;
      return false;
    }
    
    
    
    else if(this.selectedDateFilter=='Choose-date') {
      console.log('this.selectedMoments',this.selectedMoments);
      console.log("log['StartTimeRealGMT']",log['StartTimeRealGMT']);
      if(log['StartTimeRealGMT'] >= this.selectedMoments[0] &&  (this.selectedMoments[1]== null || log['StartTimeRealGMT'] <= this.selectedMoments[1]))
        return true;
      return false;
    }

  }
  
  getDateWithoutTime(date){
    var d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  deleteNotSelected(){
    
    //console.log('Debugs',this.Debugs);
    var selectedLogsId = this.Debugs.filter( function( log ) {
      return log['selected'] == false && log['display'];
    }).map(log => log.Id);
    console.log('selectedLogsId.length',selectedLogsId.length);
    if(selectedLogsId.length == 0){
      this.showDeleteAllSpinner = false;
      return false;
    }
    this.showDeleteSelectedSpinner = true;
    this.delete200Logs(selectedLogsId);    
  }

  deleteUnmatched(){
    
    
    var logIds = this.Debugs.filter( function( log ) {return  !log['display'];}).map(log => log.Id);
    console.log('delete size',logIds.length);
    if(logIds.length == 0){
      this.showDeleteSelectedSpinner = false;
      return false;
    }
    /*this.SFAPIService.deleteLogs(new Array(logIds[0]) ,this.credentials).subscribe(deletedRes => {
      console.log('deleted logs res',deletedRes);
    });*/
    this.showDeleteSelectedSpinner = true;
    this.delete200Logs(logIds);
  }
  deleteDisplayingLogs(){
    
    
    var logIds = this.Debugs.filter( function( log ) {return  log['display'];}).map(log => log.Id);
    console.log('delete size',logIds.length);
    if(logIds.length == 0){
      this.showDeleteSelectedSpinner = false;
      return false;
    }
    this.showDeleteSelectedSpinner = true;
    this.delete200Logs(logIds);
  }
}

