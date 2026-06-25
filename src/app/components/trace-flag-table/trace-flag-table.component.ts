import { Component, OnInit,Input ,OnDestroy,Inject,ChangeDetectionStrategy,EventEmitter,Output,HostListener } from '@angular/core';
import { TraceFlag } from '../../models/TraceFlag';
import { ActionConfig } from '../action-bar/action-bar.component';
import { SFAPIService } from '../../services/sf-api.service';
import {MatDialog, MAT_DIALOG_DATA,MatDialogConfig} from '@angular/material/dialog';
import {ToasterContainerComponent, ToasterService,ToasterModule,ToasterConfig} from 'angular2-toaster';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {ThemePalette} from '@angular/material/core';

import {FormControl} from '@angular/forms';

/*export interface Filter {
  name: string;
  checked: boolean;
  count:number;
  color: ThemePalette;
  filters?: Filter[];
}*/

@Component({
  selector: 'app-trace-flag-table',
  templateUrl: './trace-flag-table.component.html',
  styleUrls: ['./trace-flag-table.component.css'],
})


 
export class TraceFlagTableComponent implements OnInit {
  @HostListener('document:keydown.escape', ['$event']) onKeydownHandler(event: KeyboardEvent) {
    this.showCreateNew = false;
  }

  Filter:any;
  traceFlagCount : number;
  liveCount:number;
  expiredCount: number;
  futureCount: number;

  isSelectAll : boolean; 
  selected =0;
  users: any[] ;
  myControl = new FormControl();
  logLevelForm = new FormControl();
  selectedLogLevel :string;
  @Input() GMToffSet :number;
  @Input() credentials:Object;
  traceFlags:TraceFlag[];
  logLevels:any[];
  private toasterService: ToasterService;
  public config: ToasterConfig = 
        new ToasterConfig({
            showCloseButton: true, 
            tapToDismiss: false, 
            timeout: 3000,
            animation: 'fade',
            
  });
  showCreateNew:boolean;
  showDeleteAllSpinner:boolean;
  showsearchInFilesSpinner:boolean;
  showDeleteSelectedSpinner:boolean;
  showRefrershSpinner:boolean;

  traceFlagActions: ActionConfig[] = [
    {
      id: 'new',
      label: 'New Trace Flag',
      icon: 'plus_one',
      style: 'fab',
      variant: 'primary',
      tooltip: 'New trace flag',
      customStyle: { 'background-color': 'cadetblue', 'height': '70px', 'width': '70px', 'top': '-12px' }
    },
    {
      id: 'refresh',
      label: 'Refresh',
      icon: 'refresh',
      style: 'fab',
      variant: 'primary',
      tooltip: 'Refresh',
      isLoading: () => this.showRefrershSpinner
    },
    {
      id: 'deleteAll',
      label: 'Delete All',
      icon: 'delete',
      style: 'fab',
      variant: 'accent',
      tooltip: 'Delete All',
      badge: () => this.traceFlags ? `-${this.traceFlags.length}` : '',
      isLoading: () => this.showDeleteAllSpinner
    },
    {
      id: 'deleteSelected',
      label: 'Delete Selected',
      icon: 'delete',
      style: 'fab',
      variant: 'warn',
      tooltip: 'Delete Selected',
      badge: () => `-${this.selected}`,
      isLoading: () => this.showDeleteSelectedSpinner
    }
  ];

  onActionTriggered(id: string): void {
    switch (id) {
      case 'new':            this.showCreateNew = !this.showCreateNew; break;
      case 'refresh':        this.refreshTFromServer(); break;
      case 'deleteAll':      this.deleteAllTraceFlags(); break;
      case 'deleteSelected': this.deleteSelected(); break;
    }
  }

  constructor(private sfAPIService:SFAPIService,toasterService:ToasterService,public dialog: MatDialog) {
    this.toasterService = toasterService;
   }

  ngOnInit(): void {
      this.isSelectAll = false;
      
      this.sfAPIService.getTraceFlags(this.credentials).subscribe(traceFlags => {
        console.log('getTraceFlags res',traceFlags);
        this.traceFlags = traceFlags.records;
        this.traceFlags.forEach(f => {
          f['display'] = true;
        });
        
        setTimeout(() => {
          this.setCount();this.onSelectedHandler();
        }, 500);
      });
      this.sfAPIService.getLogLevels(this.credentials).subscribe(logLevels => {
        console.log('logLevels res',logLevels.records);
        this.logLevels = logLevels.records;
      });
   
  }

  setCount(){
    console.log('setCount')
    this.traceFlagCount = this.traceFlags.length;
    this.liveCount = this.traceFlags.filter( function( traceFlag ) {return  traceFlag['Status']=='Live';}).length;
    this.expiredCount = this.traceFlags.filter( function( traceFlag ) {return  traceFlag['Status']=='Expired';}).length;
    this.futureCount =  this.traceFlags.filter( function( traceFlag ) {return  traceFlag['Status']=='Future';}).length;

    this.Filter = {
      name: 'Show All',
      checked: true,
      color: 'primary',
      count:this.traceFlagCount,
      filters: [
        {name: 'Live', checked: true, color: 'primary',count:this.liveCount},
        {name: 'Expired', checked: true, color: 'accent', count:this.expiredCount},
        {name: 'Future', checked: true, color: 'warn', count:this.futureCount}
      ]
    };
  }
  
  deleteSelected(){
    var selectedIds = this.traceFlags.filter( function( traceFlag ) {
      return traceFlag['selected'] == true && traceFlag['display'];
    }).map(traceFlag => traceFlag.Id);
    if(selectedIds.length<1)return;
    this.showDeleteSelectedSpinner = true;
    console.log('traceFlags',this.traceFlags);
    
    console.log('selectedIds',selectedIds);
    if(selectedIds.length)
      this.deleteTraceFlags(selectedIds);  
  }



deleteAllTraceFlags():void{
    this.showDeleteAllSpinner = true;
    
    var traceFlagIds = this.traceFlags.filter( function( traceFlag ) {return  traceFlag['display'];}).map(traceFlag => traceFlag.Id);
    console.log('delete size',traceFlagIds.length);
    this.deleteTraceFlags(traceFlagIds);
    
  }

  deleteTraceFlags(Ids):void{
    var id2delete = Ids.slice(0,1);
    console.log('id2delete',id2delete);
    var that = this;
    this.sfAPIService.toolingApiDeleteOne(id2delete,this.credentials).subscribe(deletedRes => {
      console.log('deleted logs res',deletedRes);
      if(Ids.length >1){
        that.deleteTraceFlags(Ids.slice(1,Ids.length));
        that.removeDeletedTF(id2delete);
      }else{
        that.showDeleteAllSpinner = false;
        that.showDeleteSelectedSpinner = false;
        
        that.toasterService.pop('success', 'Delete', 'Done!');
        that.refreshTFromServer();
        console.log('delete logs is done');
      }
    });
  }


  refreshTFromServer():void{
    this.showRefrershSpinner = true;
    this.ngOnInit();
    this.showRefrershSpinner = false;
    this.toasterService.pop('success', 'Refersh', 'Done!');
  }

  removeDeletedTF(deletedIds):void{
    var deletedIdsSet =  new Set(deletedIds);
    this.traceFlags = this.traceFlags.filter(obj => !deletedIdsSet.has(obj.Id));
  }

  deleteOneHandler(){
    this.toasterService.pop('success', 'Delete', 'Done!');
    this.refreshTFromServer();
  }
  createNew(hour,uName){
    console.log('hour',hour);
    console.log('uName',uName);
    console.log('logLevel',this.selectedLogLevel);
    if(!uName|| !this.selectedLogLevel)return;
    var TF = {};
    TF['DebugLevelId'] = this.logLevels.filter(lv => lv['DeveloperName'] == this.selectedLogLevel)[0].Id;
    TF['TracedEntityId'] = this.users.filter(user => user['Name'] == uName)[0].Id;
    TF['LogType'] = 'USER_DEBUG';
    //var date = new Date(new Date().getTime() - this.GMToffSet);
    var date = this.sfAPIService.toRealGmt(this.GMToffSet,new Date());
    if(hour){
      date.setHours(date.getHours()+1);

      TF['ExpirationDate']= date.toISOString();    
    }
    
    console.log("TF['ExpirationDate']",TF['ExpirationDate']);
    this.sfAPIService.createTraceFlag(TF,this.credentials).subscribe(newTf => {
      console.log('newTf',newTf);
      this.toasterService.pop('success', 'new TraceFlag', 'Created!');
      this.refreshTFromServer();
      this.showCreateNew = false;
    },
    error => {
      console.log('Failed to create new traceFlag', error);
      var toast  = {
        type: 'error',
        title: 'Failed to create new traceFlag',
        body: error.error.map(e=>e.message).join(' , '),
        timeout:10000,
        showCloseButton: true,
    };
      this.toasterService.pop(toast);
      
    },
    () => {
      // 'onCompleted' callback.
      // No errors, route to new page here
    });
    

    
  }
  searchForUser(userName){
   var that = this;
   if(userName.length <2)return;
    this.sfAPIService.searchForUser(userName,this.credentials).subscribe(users => {
      console.log('users',users.records);
      that.users = users.records;
    });
    
  }

  onSelectedHandler(){
    this.selected = this.traceFlags.filter(tf => tf['selected'] &&  tf['display']).length;
  
  }
  selectAll(){
    this.traceFlags.forEach(tf => {
      tf['selected'] = this.isSelectAll;
    });
    this.onSelectedHandler();
  }

  


  allchecked: boolean = true;

  updateAllComplete() {
    this.allchecked = this.Filter.filters != null && this.Filter.filters.every(f => f.checked);
  }

  someComplete(): boolean {
    if (this.Filter.filters == null) {
      return false;
    }
   
   
     
    return this.Filter.filters.filter(f => f.checked).length > 0 && !this.allchecked;
  }

  setAll(checked: boolean) {
    this.allchecked = checked;
    if (this.Filter.filters == null) {
      return;
    }
    this.Filter.filters.forEach(f => f.checked = checked);
    this.traceFlags.forEach(f=>f['display']=checked);
    this.onSelectedHandler();
  }
  filterChangedHandler(filterName){
    console.log('@@@ this.Filter',this.Filter);
    var isCheck = this.Filter.filters.filter(f =>  f.name == filterName && f.checked ).length >0;
    
    console.log('@@@ isCheck',isCheck);
    console.log('@@@ filterName',filterName);
    console.log('TF',this.traceFlags.filter(tf =>  tf['Status'] == filterName));
      this.traceFlags.filter(tf =>  tf['Status'] == filterName).map(tf=>tf['display'] = isCheck );
      this.onSelectedHandler();
     
     //this.traceFlags.filter( function( traceFlag ) {return  traceFlag['Status']=='Expired';}).map(f=>f['display']= ExpiredCheck );
     //this.traceFlags.filter( function( traceFlag ) {return  traceFlag['Status']=='Future';}).map(f=>f['display']= FutureCheck );
  }

}


