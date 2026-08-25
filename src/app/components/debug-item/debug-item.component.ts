import { Component, OnInit,Input ,OnDestroy,Inject,ChangeDetectionStrategy,EventEmitter,Output} from '@angular/core';
import { Debug } from '../../models/Debug';
import { GetLogsService } from '../../services/get-logs.service';
import { SFAPIService } from '../../services/sf-api.service';
import {MatDialog, MAT_DIALOG_DATA,MatDialogConfig} from '@angular/material/dialog';
import {FixedSizeVirtualScrollStrategy, VIRTUAL_SCROLL_STRATEGY} from '@angular/cdk/scrolling';
import { DataService } from '../../services/data.service';
import { LogAnalyzerService } from '../../services/log-analyzer.service';
import { AiErrorAssistantService } from '../../services/ai-error-assistant.service';
import { Subscription } from 'rxjs';

@Component({
  selector: '[app-debug-item]',
  templateUrl: './debug-item.component.html',
  styleUrls: ['./debug-item.component.css']
})
export class DebugItemComponent implements OnInit, OnDestroy  {
  @Output() onItemDeleted = new EventEmitter<boolean>();
  @Output() onSelectedOne = new EventEmitter<boolean>();
  message:any;
  subscription: Subscription;
  @Input() OpenLogAsNewWindow :any;

  @Input() Debug:Debug;
  @Input() credentials:any;
  @Input() hideUnmatched:boolean;
  openNewLogTab:boolean;
  chiledWindowClosed = false;
  @Input() GMToffSet :number;
  constructor(private SFAPIService:SFAPIService ,public dialog: MatDialog,private data: DataService,private logAnalyzerService: LogAnalyzerService,private aiErrorAssistantService: AiErrorAssistantService) {
    
    
   }

  ngOnInit(): void {
    //this.subscription = this.data.currentMessage.subscribe(message => this.message = message)
    this.openNewLogTab = false;
    //this.Debug['StartTimeSTR'] = new Date(this.Debug['StartTime']).toLocaleString();
    this.Debug['StartTimeRealGMT'] = this.SFAPIService.RealGmtToLocal(this.GMToffSet,this.Debug['StartTime']);
    this.Debug['StartTimeSTR'] = this.Debug['StartTimeRealGMT'].toLocaleString() ;
    
    this.Debug['display'] = true;
    
    
  }
  ngOnDestroy() {
    this.Debug['display'] = false; 
    
   
  }
  viewLogNewTab():void{
    console.log('viewLogNewTab');
    console.log('log id',this.Debug.Id);
    console.log('this.openNewLogTab',this.openNewLogTab);
    if(this.Debug['textFile']){
      if(!this.OpenLogAsNewWindow)this.data.changeMessage(this.Debug);
      console.log('has Text file!');
      if(this.openNewLogTab ==true){
        this.openNewLogTab =false;
        var that = this;
        setTimeout(function(){that.openNewLogTab = true;} , 10);
      }else
        this.openNewLogTab =true;
        if(!this.OpenLogAsNewWindow)this.data.changeMessage(this.Debug);
    }
    else{
      this.Debug['textFileStatuse'] = 'downloading';
      this.SFAPIService.getLogText(this.Debug.Id,this.credentials).subscribe(log => {
        //console.log('log res',log);
        this.Debug['textFile'] = log;
        this.Debug['textFileStatuse'] = 'done';
        this.openNewLogTab =true;
        if(!this.OpenLogAsNewWindow)this.data.changeMessage(this.Debug);
        //this.Debugs = logs.records;
      });
    }
  }
  viewLog():void{
    console.log('log id',this.Debug.Id);
    if(this.Debug['textFile']){
      console.log('has Text file!');
      this.openDialog(this.Debug['textFile']);
    }
    else{
      this.Debug['textFileStatuse'] = 'downloading';
      this.SFAPIService.getLogText(this.Debug.Id,this.credentials).subscribe(log => {
        console.log('log res',log);
        this.Debug['textFile'] = log;
        this.Debug['textFileStatuse'] = 'done';
        this.openDialog(log);
        //this.Debugs = logs.records;
      });
    }
    
  }

  analyzeLog():void{
    console.log('analyzeLog id',this.Debug.Id);
    if(this.Debug['textFile']){
      this.logAnalyzerService.open(this.Debug['textFile'], this.Debug.Id + '.log');
    }
    else{
      this.Debug['textFileStatuse'] = 'downloading';
      this.SFAPIService.getLogText(this.Debug.Id,this.credentials).subscribe(log => {
        this.Debug['textFile'] = log;
        this.Debug['textFileStatuse'] = 'done';
        this.logAnalyzerService.open(log, this.Debug.Id + '.log');
      });
    }
  }

  aiErrorAssist():void{
    console.log('aiErrorAssist id',this.Debug.Id);
    if(this.Debug['textFile']){
      this.aiErrorAssistantService.open(this.Debug['textFile'], this.Debug.Id + '.log', this.credentials);
    }
    else{
      this.Debug['textFileStatuse'] = 'downloading';
      this.SFAPIService.getLogText(this.Debug.Id,this.credentials).subscribe(log => {
        this.Debug['textFile'] = log;
        this.Debug['textFileStatuse'] = 'done';
        this.aiErrorAssistantService.open(log, this.Debug.Id + '.log', this.credentials);
      });
    }
  }

  downLoad():void{
    console.log('log id',this.Debug.Id);
    this.SFAPIService.downloadLog(this.Debug.Id,this.credentials);
  }
  itemDeleted() {
    this.onItemDeleted.emit(true);
  }
  delete():void{
    console.log('log id',this.Debug.Id);
    var that = this;
    //this.SFAPIService.downloadLog(this.Debug.Id,this.credentials);
    this.SFAPIService.deleteLogs(new Array(this.Debug.Id) ,this.credentials).subscribe(deletedRes => {
      console.log('deleted logs res',deletedRes);
      that.itemDeleted();
    });
  }
  onSelected(){
    this.onSelectedOne.emit(true);
  }
 

  openDialog(log) {
    const dialogConfig = new MatDialogConfig();
    dialogConfig.disableClose = false;
    dialogConfig.autoFocus = true;
    dialogConfig.restoreFocus = true;
    dialogConfig.height = "100%";
    //dialogConfig.scrollStrategy
    dialogConfig.data = {
        textFile: log
    }
    
    
    this.dialog.open( LogDialog,dialogConfig);
  }
  
}


export interface DialogData {
  textFile: string;
}



@Component({
selector: 'log-dialog',
templateUrl: 'log-dialog.html',
})

export class LogDialog {
constructor(@Inject(MAT_DIALOG_DATA) public data: DialogData) {}
}
