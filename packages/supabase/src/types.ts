// Generado desde el proyecto Supabase real (xhbrhpfzehshiyjzlxnx) vía MCP.
// Regenerar con: pnpm types:generate
// NO editar a mano — cualquier cambio de schema va en migrations/000X_*.sql
// y después se regeneran los tipos.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      appointment_services: {
        Row: {
          appointment_id: string
          price_snapshot: number
          service_id: string
        }
        Insert: {
          appointment_id: string
          price_snapshot: number
          service_id: string
        }
        Update: {
          appointment_id?: string
          price_snapshot?: number
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_services_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_services_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "v_agenda"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          branch_id: string
          client_id: string | null
          created_at: string
          ends_at: string
          google_event_id: string | null
          id: string
          operator_id: string | null
          source: Database["public"]["Enums"]["appointment_source"]
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          tenant_id: string
        }
        Insert: {
          branch_id: string
          client_id?: string | null
          created_at?: string
          ends_at: string
          google_event_id?: string | null
          id?: string
          operator_id?: string | null
          source?: Database["public"]["Enums"]["appointment_source"]
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          tenant_id: string
        }
        Update: {
          branch_id?: string
          client_id?: string | null
          created_at?: string
          ends_at?: string
          google_event_id?: string | null
          id?: string
          operator_id?: string | null
          source?: Database["public"]["Enums"]["appointment_source"]
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          phone: string | null
          tenant_id: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
          tenant_id: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_sessions: {
        Row: {
          branch_id: string
          closed_at: string | null
          closed_by: string | null
          counted_total: number | null
          difference: number | null
          expected_total: number | null
          id: string
          opened_at: string
          opened_by: string
          opening_amount: number
          tenant_id: string
        }
        Insert: {
          branch_id: string
          closed_at?: string | null
          closed_by?: string | null
          counted_total?: number | null
          difference?: number | null
          expected_total?: number | null
          id?: string
          opened_at?: string
          opened_by: string
          opening_amount?: number
          tenant_id: string
        }
        Update: {
          branch_id?: string
          closed_at?: string | null
          closed_by?: string | null
          counted_total?: number | null
          difference?: number | null
          expected_total?: number | null
          id?: string
          opened_at?: string
          opened_by?: string
          opening_amount?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_history: {
        Row: {
          appointment_id: string | null
          branch_id: string | null
          client_id: string
          id: string
          operator_id: string | null
          performed_at: string
          photos: Json
          service_id: string | null
          technical_notes: string | null
          tenant_id: string
        }
        Insert: {
          appointment_id?: string | null
          branch_id?: string | null
          client_id: string
          id?: string
          operator_id?: string | null
          performed_at?: string
          photos?: Json
          service_id?: string | null
          technical_notes?: string | null
          tenant_id: string
        }
        Update: {
          appointment_id?: string | null
          branch_id?: string | null
          client_id?: string
          id?: string
          operator_id?: string | null
          performed_at?: string
          photos?: Json
          service_id?: string | null
          technical_notes?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_history_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "v_agenda"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          birthday: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          notes: string | null
          phone: string | null
          tenant_id: string
        }
        Insert: {
          birthday?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          phone?: string | null
          tenant_id: string
        }
        Update: {
          birthday?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_ledger: {
        Row: {
          amount: number
          id: string
          operator_id: string
          period: string
          rule_snapshot: Json
          sale_item_id: string
          settled: boolean
          tenant_id: string
        }
        Insert: {
          amount: number
          id?: string
          operator_id: string
          period: string
          rule_snapshot?: Json
          sale_item_id: string
          settled?: boolean
          tenant_id: string
        }
        Update: {
          amount?: number
          id?: string
          operator_id?: string
          period?: string
          rule_snapshot?: Json
          sale_item_id?: string
          settled?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_ledger_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_ledger_sale_item_id_fkey"
            columns: ["sale_item_id"]
            isOneToOne: false
            referencedRelation: "sale_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_ledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_rules: {
        Row: {
          base_salary: number
          id: string
          name: string
          product_sale_pct: number
          rules: Json
          service_pct: number
          tenant_id: string
        }
        Insert: {
          base_salary?: number
          id?: string
          name: string
          product_sale_pct?: number
          rules?: Json
          service_pct?: number
          tenant_id: string
        }
        Update: {
          base_salary?: number
          id?: string
          name?: string
          product_sale_pct?: number
          rules?: Json
          service_pct?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory: {
        Row: {
          branch_id: string
          current_stock: number
          item_id: string
          item_type: Database["public"]["Enums"]["inventory_item_type"]
          min_alert_level: number
        }
        Insert: {
          branch_id: string
          current_stock?: number
          item_id: string
          item_type: Database["public"]["Enums"]["inventory_item_type"]
          min_alert_level?: number
        }
        Update: {
          branch_id?: string
          current_stock?: number
          item_id?: string
          item_type?: Database["public"]["Enums"]["inventory_item_type"]
          min_alert_level?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          delta: number
          id: string
          item_id: string
          item_type: Database["public"]["Enums"]["inventory_item_type"]
          note: string | null
          reason: Database["public"]["Enums"]["inventory_movement_reason"]
          resulting_stock: number
          tenant_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          item_id: string
          item_type: Database["public"]["Enums"]["inventory_item_type"]
          note?: string | null
          reason: Database["public"]["Enums"]["inventory_movement_reason"]
          resulting_stock: number
          tenant_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          item_id?: string
          item_type?: Database["public"]["Enums"]["inventory_item_type"]
          note?: string | null
          reason?: Database["public"]["Enums"]["inventory_movement_reason"]
          resulting_stock?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          branch_id: string | null
          commission_rule_id: string | null
          created_at: string
          google_calendar_token: Json | null
          id: string
          role: Database["public"]["Enums"]["membership_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          branch_id?: string | null
          commission_rule_id?: string | null
          created_at?: string
          google_calendar_token?: Json | null
          id?: string
          role: Database["public"]["Enums"]["membership_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          branch_id?: string | null
          commission_rule_id?: string | null
          created_at?: string
          google_calendar_token?: Json | null
          id?: string
          role?: Database["public"]["Enums"]["membership_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_memberships_commission_rule"
            columns: ["commission_rule_id"]
            isOneToOne: false
            referencedRelation: "commission_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          sale_id: string
        }
        Insert: {
          amount: number
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          sale_id: string
        }
        Update: {
          amount?: number
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      retail_products: {
        Row: {
          cost: number
          deleted_at: string | null
          id: string
          name: string
          sale_price: number
          tenant_id: string
        }
        Insert: {
          cost?: number
          deleted_at?: string | null
          id?: string
          name: string
          sale_price?: number
          tenant_id: string
        }
        Update: {
          cost?: number
          deleted_at?: string | null
          id?: string
          name?: string
          sale_price?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retail_products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          id: string
          item_id: string
          item_type: Database["public"]["Enums"]["sale_item_type"]
          operator_id: string | null
          quantity: number
          sale_id: string
          unit_price: number
        }
        Insert: {
          id?: string
          item_id: string
          item_type: Database["public"]["Enums"]["sale_item_type"]
          operator_id?: string | null
          quantity?: number
          sale_id: string
          unit_price: number
        }
        Update: {
          id?: string
          item_id?: string
          item_type?: Database["public"]["Enums"]["sale_item_type"]
          operator_id?: string | null
          quantity?: number
          sale_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          appointment_id: string | null
          branch_id: string
          cash_session_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          discount: number
          id: string
          tenant_id: string
          total: number
        }
        Insert: {
          appointment_id?: string | null
          branch_id: string
          cash_session_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          discount?: number
          id?: string
          tenant_id: string
          total?: number
        }
        Update: {
          appointment_id?: string | null
          branch_id?: string
          cash_session_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          discount?: number
          id?: string
          tenant_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "v_agenda"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      service_supplies: {
        Row: {
          quantity_consumed: number
          service_id: string
          supply_id: string
        }
        Insert: {
          quantity_consumed: number
          service_id: string
          supply_id: string
        }
        Update: {
          quantity_consumed?: number
          service_id?: string
          supply_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_supplies_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_supplies_supply_id_fkey"
            columns: ["supply_id"]
            isOneToOne: false
            referencedRelation: "supplies"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          category: string | null
          deleted_at: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          name: string
          price: number
          tenant_id: string
        }
        Insert: {
          category?: string | null
          deleted_at?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name: string
          price?: number
          tenant_id: string
        }
        Update: {
          category?: string | null
          deleted_at?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      supplies: {
        Row: {
          cost_per_unit: number
          deleted_at: string | null
          id: string
          name: string
          tenant_id: string
          unit: Database["public"]["Enums"]["supply_unit"]
        }
        Insert: {
          cost_per_unit?: number
          deleted_at?: string | null
          id?: string
          name: string
          tenant_id: string
          unit?: Database["public"]["Enums"]["supply_unit"]
        }
        Update: {
          cost_per_unit?: number
          deleted_at?: string | null
          id?: string
          name?: string
          tenant_id?: string
          unit?: Database["public"]["Enums"]["supply_unit"]
        }
        Relationships: [
          {
            foreignKeyName: "supplies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          business_name: string
          created_at: string
          id: string
          mode: Database["public"]["Enums"]["tenant_mode"]
          promo_ends_at: string | null
          settings: Json
          stripe_customer_id: string | null
          subscription_status: Database["public"]["Enums"]["subscription_status"]
        }
        Insert: {
          business_name: string
          created_at?: string
          id?: string
          mode?: Database["public"]["Enums"]["tenant_mode"]
          promo_ends_at?: string | null
          settings?: Json
          stripe_customer_id?: string | null
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
        }
        Update: {
          business_name?: string
          created_at?: string
          id?: string
          mode?: Database["public"]["Enums"]["tenant_mode"]
          promo_ends_at?: string | null
          settings?: Json
          stripe_customer_id?: string | null
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
        }
        Relationships: []
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      v_agenda: {
        Row: {
          branch_id: string | null
          client_id: string | null
          client_name: string | null
          client_phone: string | null
          ends_at: string | null
          google_event_id: string | null
          id: string | null
          operator_id: string | null
          operator_name: string | null
          services: Json | null
          source: Database["public"]["Enums"]["appointment_source"] | null
          starts_at: string | null
          status: Database["public"]["Enums"]["appointment_status"] | null
          tenant_id: string | null
          total_price: number | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_client_history: {
        Row: {
          appointment_id: string | null
          branch_id: string | null
          branch_name: string | null
          client_id: string | null
          id: string | null
          operator_id: string | null
          operator_name: string | null
          performed_at: string | null
          photos: Json | null
          service_id: string | null
          service_name: string | null
          technical_notes: string | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_history_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "v_agenda"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_inventory: {
        Row: {
          below_minimum: boolean | null
          branch_id: string | null
          branch_name: string | null
          cost_per_unit: number | null
          current_stock: number | null
          item_id: string | null
          item_type: Database["public"]["Enums"]["inventory_item_type"] | null
          min_alert_level: number | null
          name: string | null
          sale_price: number | null
          tenant_id: string | null
          unit: Database["public"]["Enums"]["supply_unit"] | null
        }
        Relationships: [
          {
            foreignKeyName: "branches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      adjust_stock: {
        Args: {
          p_branch_id: string
          p_delta: number
          p_item_id: string
          p_item_type: Database["public"]["Enums"]["inventory_item_type"]
          p_note?: string | null
          p_reason: Database["public"]["Enums"]["inventory_movement_reason"]
        }
        Returns: number
      }
      book_appointment: {
        Args: {
          p_branch_id: string
          p_client_id: string
          p_operator_id: string
          p_service_ids: string[]
          p_source?: Database["public"]["Enums"]["appointment_source"]
          p_starts_at: string
        }
        Returns: {
          appointment_id: string
          ends_at: string
          starts_at: string
        }[]
      }
      record_stock_count: {
        Args: {
          p_branch_id: string
          p_counted: number
          p_item_id: string
          p_item_type: Database["public"]["Enums"]["inventory_item_type"]
          p_note?: string | null
        }
        Returns: number
      }
      soft_delete_inventory_item: {
        Args: {
          p_item_id: string
          p_item_type: Database["public"]["Enums"]["inventory_item_type"]
        }
        Returns: undefined
      }
      soft_delete_service: {
        Args: {
          p_service_id: string
        }
        Returns: undefined
      }
      provision_tenant: {
        Args: {
          p_branch_name?: string
          p_business_name: string
          p_currency?: string
          p_mode?: Database["public"]["Enums"]["tenant_mode"]
          p_promo_days?: number
          p_timezone?: string
        }
        Returns: {
          branch_id: string
          tenant_id: string
        }[]
      }
    }
    Enums: {
      appointment_source: "internal" | "google" | "online_booking"
      appointment_status:
        | "booked"
        | "confirmed"
        | "in_progress"
        | "done"
        | "no_show"
        | "cancelled"
      inventory_item_type: "supply" | "product"
      inventory_movement_reason:
        | "compra"
        | "rotura"
        | "recuento"
        | "ajuste"
        | "venta"
      membership_role: "owner" | "supervisor" | "operator"
      payment_method: "cash" | "card" | "transfer" | "mp" | "other"
      sale_item_type: "service" | "product"
      subscription_status:
        | "trial"
        | "promo"
        | "active"
        | "past_due"
        | "cancelled"
      supply_unit: "ml" | "gr" | "unit"
      tenant_mode: "single" | "multi"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      appointment_source: ["internal", "google", "online_booking"],
      appointment_status: [
        "booked",
        "confirmed",
        "in_progress",
        "done",
        "no_show",
        "cancelled",
      ],
      inventory_item_type: ["supply", "product"],
      inventory_movement_reason: [
        "compra",
        "rotura",
        "recuento",
        "ajuste",
        "venta",
      ],
      membership_role: ["owner", "supervisor", "operator"],
      payment_method: ["cash", "card", "transfer", "mp", "other"],
      sale_item_type: ["service", "product"],
      subscription_status: [
        "trial",
        "promo",
        "active",
        "past_due",
        "cancelled",
      ],
      supply_unit: ["ml", "gr", "unit"],
      tenant_mode: ["single", "multi"],
    },
  },
} as const
