import { Navigate } from 'react-router-dom'

import { useMeta } from '../lib/api'
import { ErrorState, Loading } from './PageState'

/** /years と /finals を最新の年へ送る。ナビの「年度別」「決勝」はここを指す */
export default function LatestRedirect({ kind }: { kind: 'years' | 'finals' }) {
  const { data: meta, isError } = useMeta()
  if (isError) return <ErrorState />
  if (!meta) return <Loading />
  const year = kind === 'years' ? meta.latestYear : meta.finalsYears.at(-1)
  return <Navigate to={year ? `/${kind}/${year}` : '/'} replace />
}
