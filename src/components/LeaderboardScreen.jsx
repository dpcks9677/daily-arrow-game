import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { getDailySeed } from '../utils';

export default function LeaderboardScreen({ onHome }) {
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const dailySeed = getDailySeed().toString();
        const scoresRef = collection(db, 'leaderboard', dailySeed, 'scores');
        // 시간 오름차순 (가장 짧은 시간이 1등) 정렬
        const q = query(scoresRef, orderBy('time', 'asc'), limit(50));
        const snapshot = await getDocs(q);
        
        const fetchedScores = [];
        let rank = 1;
        snapshot.forEach((doc) => {
          fetchedScores.push({ id: doc.id, rank: rank++, ...doc.data() });
        });
        setScores(fetchedScores);
      } catch (e) {
        console.error("Error fetching leaderboard:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchLeaderboard();
  }, []);

  return (
    <div className="leaderboard-screen">
      <div className="game-header">
        <button className="back-btn" onClick={onHome}>← Home</button>
      </div>
      
      <h1>Global Leaderboard</h1>
      <p className="subtitle">Today's Top Players</p>

      <div className="leaderboard-container">
        {loading ? (
          <p style={{ textAlign: 'center', color: '#94a3b8' }}>Loading...</p>
        ) : (
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th style={{ width: '80px' }}>Rank</th>
                <th style={{ width: '40%' }}>Name</th>
                <th>Time</th>
                <th>Mistakes</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((player) => {
                const getMedal = (rank) => {
                  if (rank === 1) return '🥇';
                  if (rank === 2) return '🥈';
                  if (rank === 3) return '🥉';
                  return '';
                };
                
                return (
                  <tr key={player.id}>
                    <td>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '60px' }}>
                        <span style={{ fontSize: '1.2em' }}>{getMedal(player.rank)}</span>
                        <span>{player.rank}</span>
                      </div>
                    </td>
                    <td>{player.nickname}</td>
                    <td>{Number(player.time).toFixed(2)}s</td>
                    <td>{player.mistakes}</td>
                  </tr>
                );
              })}
              {scores.length === 0 && (
                <tr><td colSpan="4" style={{textAlign:'center'}}>아직 등록된 기록이 없습니다!</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
