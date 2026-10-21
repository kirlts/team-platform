import { useNavigate } from 'react-router'

export function useNavigateTo() {
  const navigate = useNavigate()
  return (to: string) => navigate(to)
}
