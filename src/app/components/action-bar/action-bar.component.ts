import { Component, Input, Output, EventEmitter } from '@angular/core';

export interface ActionConfig {
  id: string;
  label: string;
  icon?: string;
  variant?: 'primary' | 'accent' | 'warn' | 'default';
  style?: 'fab' | 'mini-fab' | 'raised' | 'icon';
  tooltip?: string;
  badge?: () => string;
  showIf?: () => boolean;
  disabled?: () => boolean;
  isLoading?: () => boolean;
  customStyle?: { [key: string]: string };
}

@Component({
  selector: 'app-action-bar',
  templateUrl: './action-bar.component.html',
  styleUrls: ['./action-bar.component.css']
})
export class ActionBarComponent {
  @Input() actions: ActionConfig[] = [];
  @Output() actionTriggered = new EventEmitter<string>();

  trigger(id: string): void {
    this.actionTriggered.emit(id);
  }

  isVisible(action: ActionConfig): boolean {
    return !action.showIf || action.showIf();
  }

  isDisabled(action: ActionConfig): boolean {
    return !!(action.disabled && action.disabled());
  }

  showSpinner(action: ActionConfig): boolean {
    return !!(action.isLoading && action.isLoading());
  }

  getBadge(action: ActionConfig): string {
    return action.badge ? action.badge() : '';
  }
}
