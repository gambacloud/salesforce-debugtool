import { BrowserModule } from '@angular/platform-browser';
import {ClipboardModule} from '@angular/cdk/clipboard';
import { NgModule } from '@angular/core';
import { HttpClientModule } from '@angular/common/http';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import {ScrollingModule} from '@angular/cdk/scrolling'
import {MatSlideToggleModule} from '@angular/material/slide-toggle';
//import { MyCMPComponent } from './components/my-cmp/my-cmp.component';
import { TraceFlagItemComponent } from './components/trace-flag-item/trace-flag-item.component';
import {MatFormFieldModule,} from '@angular/material/form-field';
import { DebugItemComponent } from './components/debug-item/debug-item.component';
import { TraceFlagTableComponent } from './components/trace-flag-table/trace-flag-table.component';
import { DebugTableComponent } from './components/debug-table/debug-table.component';
import { AuthorizationComponent } from './components/authorization/authorization.component';
import { ViewLogComponent } from './components/view-log/view-log.component';
import {MatDialogModule, MAT_DIALOG_DEFAULT_OPTIONS} from '@angular/material/dialog';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations'; 
import {MAT_FORM_FIELD_DEFAULT_OPTIONS} from '@angular/material/form-field';
import {FormsModule, ReactiveFormsModule} from '@angular/forms';
import {MatNativeDateModule} from '@angular/material/core';
import {MatTabsModule,MatTabLabel,MatTabLabelWrapper} from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {ToasterModule, ToasterService} from 'angular2-toaster';
import {MatAutocompleteModule} from '@angular/material/autocomplete';
import {MatButtonModule} from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import {MatRadioModule} from '@angular/material/radio';
import { OwlDateTimeModule, OwlNativeDateTimeModule } from 'ng-pick-datetime';
import {MatGridListModule} from '@angular/material/grid-list'
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatTableModule} from '@angular/material/table';
import { DebugWindowComponent } from './components/debug-window/debug-window.component';
import { PortalModule } from '@angular/cdk/portal';

import { RouterModule, Routes } from '@angular/router';

import { WindowComponent } from './components/window/window.component';  
import { Ng2SearchPipeModule } from 'ng2-search-filter';
import { MatTableDataSource} from '@angular/material/table';

import {  MatSort} from '@angular/material/sort';
import {  MatPaginator} from '@angular/material/paginator';
import { LogTabComponent } from './components/log-tab/log-tab.component';
import { ActionBarComponent } from './components/action-bar/action-bar.component';
import {MatListModule} from '@angular/material/list';
import {MatExpansionModule} from '@angular/material/expansion';
const appRoutes: Routes = [ 
 
];  
@NgModule({
  exports: [ClipboardModule],
  declarations: [
    AppComponent,
    TraceFlagItemComponent,
    DebugItemComponent,
    TraceFlagTableComponent,
    DebugTableComponent,
    AuthorizationComponent,
    ViewLogComponent,
    DebugWindowComponent,
    
    WindowComponent,

    LogTabComponent,
    ActionBarComponent
  ],
  imports: [
    MatSlideToggleModule,
    ScrollingModule,
    MatExpansionModule,
    MatListModule,
    Ng2SearchPipeModule,
    RouterModule.forRoot(appRoutes),
    PortalModule,
    MatTableModule,
    MatCheckboxModule,
    MatGridListModule,
    OwlDateTimeModule, 
    OwlNativeDateTimeModule,
    MatRadioModule,
    MatInputModule,
    MatButtonModule,
    MatAutocompleteModule,
    ToasterModule.forRoot(),
    MatSelectModule,
    MatIconModule,
    MatFormFieldModule,
    MatTabsModule,
    HttpClientModule,
    BrowserModule,
    AppRoutingModule,
    MatDialogModule,
    BrowserAnimationsModule,
    FormsModule,
    HttpClientModule,
    MatNativeDateModule,
    ReactiveFormsModule,
    MatProgressSpinnerModule
  ],
  providers: [{ provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'fill' } }
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
