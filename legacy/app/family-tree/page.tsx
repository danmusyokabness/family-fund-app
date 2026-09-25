'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function FamilyTreePage() {
  const router = useRouter();
  const [nodes, setNodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editNodeId, setEditNodeId] = useState<string | null>(null);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  
  const [name, setName] = useState('');
  const [spouseName, setSpouseName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [contributionAmount, setContributionAmount] = useState('');
  const [relationType, setRelationType] = useState('spouse');

  useEffect(() => {
    fetchFamilyTree();
  }, []);

  async function fetchFamilyTree() {
    try {
      const res = await fetch('/api/family-tree');
      const data = await res.json();
      setNodes(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch family tree', err);
    } finally {
      setLoading(false);
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 150;
        const MAX_HEIGHT = 150;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        setImageUrl(dataUrl);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  async function handleSaveMember(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    if (isEditing && editNodeId) {
      await fetch('/api/family-tree', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editNodeId,
          full_name: name,
          name: name,
          spouse_name: spouseName,
          birth_date: birthDate,
          image_url: imageUrl,
        }),
      });
    } else {
      let parentIdToUse = selectedParentId;
      let finalRelation = parentIdToUse ? 'child' : relationType;

      await fetch('/api/family-tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: name,
          name: name,
          spouse_name: spouseName,
          parent_id: parentIdToUse,
          birth_date: birthDate,
          image_url: imageUrl,
          relation_type: finalRelation,
        }),
      });

      if (contributionAmount && Number(contributionAmount) > 0) {
        await fetch('/api/contributions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, amount: Number(contributionAmount) }),
        });
      }
    }

    closeModal();
    fetchFamilyTree();
  }

  function openAddModal(parentId: string | null = null) {
    setIsEditing(false);
    setEditNodeId(null);
    setSelectedParentId(parentId);
    setName('');
    setSpouseName('');
    setBirthDate('');
    setImageUrl('');
    setContributionAmount('');
    setRelationType(parentId ? 'child' : 'spouse');
    setIsModalOpen(true);
  }

  function openEditModal(node: any) {
    setIsEditing(true);
    setEditNodeId(node.id);
    setName(node.full_name || node.name || '');
    setSpouseName(node.spouse_name || '');
    setBirthDate(node.birth_date || '');
    setImageUrl(node.image_url || '');
    setContributionAmount('');
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setIsEditing(false);
    setEditNodeId(null);
    setSelectedParentId(null);
    setName('');
    setSpouseName('');
    setBirthDate('');
    setImageUrl('');
    setContributionAmount('');
  }

  const rootNodes = nodes.filter((n) => !n.parent_id);
  const founders = rootNodes.filter((n) => n.relation_type !== 'sibling_mark' && n.relation_type !== 'sibling_rose');
  const markSiblings = nodes.filter((n) => n.relation_type === 'sibling_mark');
  const roseSiblings = nodes.filter((n) => n.relation_type === 'sibling_rose');

  function renderChildren(parentId: string) {
    const children = nodes
      .filter((n) => n.parent_id === parentId)
      .sort((a, b) => new Date(a.birth_date || a.created_at || 0).getTime() - new Date(b.birth_date || b.created_at || 0).getTime());

    if (children.length === 0) return null;

    return (
      <div className="flex flex-col items-center w-full relative pt-8">
        {/* Vertical stem dropping from parent */}
        <div className="absolute top-0 w-0.5 h-8 bg-slate-300"></div>

        {/* Horizontal span line for multiple children */}
        {children.length > 1 && (
          <div className="absolute top-8 w-[75%] h-0.5 bg-slate-300"></div>
        )}

        <div className="flex flex-row flex-wrap justify-center gap-12 w-full pt-4">
          {children.map((child) => {
            const displayName = child.full_name || child.name || 'Unnamed';
            return (
              <div key={child.id} className="flex flex-col items-center relative min-w-[170px] max-w-[210px]">
                {/* Vertical segment connecting horizontal span to child card */}
                <div className="absolute -top-4 w-0.5 h-4 bg-slate-300"></div>

                <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm text-center w-full relative group hover:shadow-md transition">
                  {child.image_url ? (
                    <img src={child.image_url} alt={displayName} className="w-14 h-14 rounded-full mx-auto mb-2 object-cover border border-slate-200" />
                  ) : (
                    <div className="w-14 h-14 rounded-full mx-auto mb-2 bg-slate-100 flex items-center justify-center text-slate-400 font-bold text-sm">
                      {displayName.substring(0, 2).toUpperCase()}
                    </div>
                  )}

                  <div className="font-bold text-slate-900 text-xs truncate" title={displayName}>
                    {displayName}
                  </div>
                  {child.spouse_name && (
                    <div className="text-slate-600 text-[11px] truncate mt-0.5" title={`& ${child.spouse_name}`}>
                      & {child.spouse_name}
                    </div>
                  )}

                  <div className="flex justify-center gap-2 mt-3">
                    <button
                      onClick={() => openAddModal(child.id)}
                      className="w-7 h-7 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-full font-bold text-xs inline-flex items-center justify-center hover:bg-emerald-600 hover:text-white transition"
                      title="Add child"
                    >
                      +
                    </button>
                    <button
                      onClick={() => openEditModal(child)}
                      className="w-7 h-7 bg-slate-50 text-slate-600 border border-slate-200 rounded-full font-bold text-[10px] inline-flex items-center justify-center hover:bg-slate-700 hover:text-white transition"
                      title="Edit entry"
                    >
                      ✎
                    </button>
                  </div>
                </div>

                {renderChildren(child.id)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 font-sans w-full pb-16">
      <div className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-4 shadow-sm w-full">
        <div className="w-full flex flex-col sm:flex-row justify-between items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Family Lineage & Tree</h1>
            <p className="text-xs text-slate-500">Mark Mukweyi Kataka & Rose Muyoka Kataka</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => openAddModal(null)}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold shadow-sm hover:bg-emerald-700 transition"
            >
              + Add Member
            </button>
            <Link href="/admin" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold shadow-sm hover:bg-indigo-700 transition">
              Admin Portal
            </Link>
            <Link href="/" className="px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-sm hover:bg-slate-900 transition">
              Back to Homepage
            </Link>
          </div>
        </div>
      </div>

      <div className="px-4 pt-28 w-full">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm overflow-x-auto min-h-[650px] flex flex-col items-center w-full">
          {loading ? (
            <p className="text-slate-500 mt-20">Loading family tree...</p>
          ) : rootNodes.length === 0 ? (
            <div className="text-center mt-20">
              <p className="text-slate-500 mb-4">No root anchor found.</p>
              <button
                onClick={() => {
                  setName('Mark Mukweyi Kataka');
                  setSpouseName('Rose Muyoka Kataka');
                  setIsModalOpen(true);
                }}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold"
              >
                Create Root Founder Couple
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center w-full space-y-12">
              
              {/* SIBLINGS TIER */}
              {(markSiblings.length > 0 || roseSiblings.length > 0) && (
                <div className="w-full flex flex-col items-center pb-6 border-b border-slate-200">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-4">Extended Generation (Siblings)</span>
                  <div className="flex flex-wrap justify-center gap-12 w-full">
                    
                    {markSiblings.length > 0 && (
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] font-semibold text-emerald-700 mb-2">Siblings of Mark</span>
                        <div className="flex flex-row gap-4">
                          {markSiblings.map((sib) => (
                            <div key={sib.id} className="bg-slate-50 border border-slate-200 p-3 rounded-xl shadow-sm text-center w-[150px] relative">
                              <div className="font-bold text-slate-800 text-xs truncate">{sib.full_name || sib.name}</div>
                              {sib.spouse_name && <div className="text-slate-500 text-[10px] mt-0.5">& {sib.spouse_name}</div>}
                              <button onClick={() => openEditModal(sib)} className="mt-2 text-[10px] text-slate-500 underline hover:text-slate-800">Edit</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {roseSiblings.length > 0 && (
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] font-semibold text-emerald-700 mb-2">Siblings of Rose</span>
                        <div className="flex flex-row gap-4">
                          {roseSiblings.map((sib) => (
                            <div key={sib.id} className="bg-slate-50 border border-slate-200 p-3 rounded-xl shadow-sm text-center w-[150px] relative">
                              <div className="font-bold text-slate-800 text-xs truncate">{sib.full_name || sib.name}</div>
                              {sib.spouse_name && <div className="text-slate-500 text-[10px] mt-0.5">& {sib.spouse_name}</div>}
                              <button onClick={() => openEditModal(sib)} className="mt-2 text-[10px] text-slate-500 underline hover:text-slate-800">Edit</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              )}

              {/* FOUNDERS & DESCENDANTS TIER */}
              <div className="flex flex-col items-center w-full">
                {founders.map((root) => {
                  const rootName = root.full_name || root.name || 'Mark Mukweyi Kataka';
                  return (
                    <div key={root.id} className="flex flex-col items-center w-full">
                      <div className="bg-emerald-50 border border-emerald-300 p-6 rounded-2xl shadow-sm text-center min-w-[260px] relative">
                        <span className="text-[10px] uppercase font-bold text-emerald-700 tracking-wider block mb-1">Founders</span>
                        <div className="font-extrabold text-slate-900 text-base">
                          {rootName}
                        </div>
                        <div className="text-slate-700 text-sm mt-0.5">
                          & {root.spouse_name || 'Rose Muyoka Kataka'}
                        </div>
                        <div className="flex justify-center gap-2 mt-4">
                          <button
                            onClick={() => openAddModal(root.id)}
                            className="px-3 py-1.5 bg-emerald-600 text-white rounded-full font-bold text-xs hover:bg-emerald-700 transition"
                          >
                            + Add Child
                          </button>
                          <button
                            onClick={() => openEditModal(root)}
                            className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-full font-bold text-xs hover:bg-slate-300 transition"
                          >
                            Edit
                          </button>
                        </div>
                      </div>

                      {renderChildren(root.id)}
                    </div>
                  );
                })}
              </div>

            </div>
          )}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-800">
              {isEditing ? 'Edit Family Member' : 'Add Family Member'}
            </h3>
            <form onSubmit={handleSaveMember} className="space-y-4">
              {!isEditing && selectedParentId === null && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Relationship</label>
                  <select
                    value={relationType}
                    onChange={(e) => setRelationType(e.target.value)}
                    className="w-full p-2.5 border border-slate-300 rounded-lg text-sm bg-slate-50"
                  >
                    <option value="spouse">Co-Founder / Spouse</option>
                    <option value="sibling_mark">Sibling of Mark Kataka</option>
                    <option value="sibling_rose">Sibling of Rose Kataka</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g. John Kataka"
                  className="w-full p-2.5 border border-slate-300 rounded-lg text-sm bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Spouse Name (Optional)</label>
                <input
                  type="text"
                  value={spouseName}
                  onChange={(e) => setSpouseName(e.target.value)}
                  placeholder="e.g. Mary Kataka"
                  className="w-full p-2.5 border border-slate-300 rounded-lg text-sm bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Birth Date (For Age Sorting)</label>
                <input
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-lg text-sm bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Upload Photo (Low Size)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
                />
                {imageUrl && <p className="text-[11px] text-emerald-600 mt-1">Image compressed and ready.</p>}
              </div>
              {!isEditing && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Contribution Amount (KES - Optional)</label>
                  <input
                    type="number"
                    value={contributionAmount}
                    onChange={(e) => setContributionAmount(e.target.value)}
                    placeholder="e.g. 500"
                    className="w-full p-2.5 border border-slate-300 rounded-lg text-sm bg-slate-50"
                  />
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}