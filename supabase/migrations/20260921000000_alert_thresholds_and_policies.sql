-- Alert thresholds: per-belt overrides plus global defaults (belt_id IS NULL)
CREATE TABLE public.alert_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  belt_id UUID REFERENCES public.conveyor_belts(id) ON DELETE CASCADE,
  metric TEXT NOT NULL CHECK (metric IN ('temperature', 'vibration', 'load_percentage', 'speed')),
  direction TEXT NOT NULL DEFAULT 'above' CHECK (direction IN ('above', 'below')),
  warning_value DECIMAL NOT NULL,
  critical_value DECIMAL NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.alert_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view thresholds"
  ON public.alert_thresholds FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins and operators can manage thresholds"
  ON public.alert_thresholds FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

CREATE POLICY "Admins and operators can update thresholds"
  ON public.alert_thresholds FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

CREATE POLICY "Admins can delete thresholds"
  ON public.alert_thresholds FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to remove belts (belt cards, CRUD)
CREATE POLICY "Admins can delete belts"
  ON public.conveyor_belts FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to manage user roles (promote/demote users)
CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to view all user profiles (user management page)
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert roles"
  ON public.user_roles FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update roles"
  ON public.user_roles FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete roles"
  ON public.user_roles FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Seed global default thresholds
INSERT INTO public.alert_thresholds (belt_id, metric, direction, warning_value, critical_value) VALUES
  (NULL, 'temperature', 'above', 60, 75),
  (NULL, 'vibration', 'above', 5, 7.5),
  (NULL, 'load_percentage', 'above', 90, 97),
  (NULL, 'speed', 'below', 2.5, 1.5);

CREATE TRIGGER update_alert_thresholds_updated_at
  BEFORE UPDATE ON public.alert_thresholds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
